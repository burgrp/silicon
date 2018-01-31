const pro = require("util").promisify;
const fs = require("fs");
const spawn = require("child_process").spawn;
const codeGen = require("./code-gen.js");
const rmDir = require("./rmdir.js");
const Telnet = require("telnet-client");

module.exports = async config => {

	return {
		async init(cli) {
			return cli.command("build")
					.option("-v, --verbose", "be verbose, display commands being run")
					.option("-d, --dependencies [dependencies]", "run 'npm install' to update dependencies prior to the build")
					.option("-a, --disassembly", "run 'objdump' to disassembly the image after build")
					.option("-s, --size", "run 'size' to display image size after build")
					.option("-f, --flash [port]", "flash the image using OpenOCD on given localhost port, defaults to 4444")
					.option("-l, --loop", "stay in loop and repeat build after each source file modification");

		},

		async start(command) {

			async function run(cmd, ...args) {
				if (command.verbose) {
					console.info(cmd, ...args);
				}
				return new Promise((resolve, reject) => {
					let proc = spawn(cmd, args, {
						stdio: "inherit"
					});
					proc.on("close", code => {
						if (code === 0) {
							resolve();
						} else {
							reject(`${cmd} returned code ${code}`);
						}
					});
				});
			}

			let watched;

			async function build() {

				watched = [];
				let buildDir = "build";

				await rmDir(buildDir, true);
				try {
					await pro(fs.mkdir)(buildDir);
				} catch (e) {
					if (e.code !== "EEXIST") {
						throw e;
					}
				}

				if (command.dependencies) {
					await run("npm", "install");
				}

				let packages = {};

				async function scan(directory) {

					if (command.verbose) {
						console.info("Scanning", directory);
					}

					let package = JSON.parse(await pro(fs.readFile)(directory + "/package.json", "utf8"));
					watched.push(directory + "/package.json");

					if (packages[package.name]) {

						if (package.version !== packages[package.name].version) {
							throw `${package.name} version conflict ${package.version} ${packages[package.name].version}`;
						}

					} else {

						package.directory = directory;

						for (let dep in package.dependencies) {
							await scan("./node_modules/" + dep);
						}

						packages[package.name] = package;
					}

				}

				await scan(".");
				let siliconPackages = Object.values(packages).filter(p => p.silicon);

				let target;
				siliconPackages.forEach(p => {
					if (p.silicon && p.silicon.target) {
						if (target) {
							throw "Target is defined twice";
						}
						target = p.silicon.target;
					}
				});

				let cpu = config.cpus[target.cpu];
				if (!cpu) {
					throw "Unsupported CPU: " + target.cpu;
				}

				function mapToArray(map, firstIndex = 0) {
					return 	Object.entries(map).reduce((acc, [k, v]) => {
						acc[parseInt(k) - firstIndex] = v;
						return acc;
					}, []);
				}

				let interrupts = mapToArray(cpu.interrupts || {}, 1).concat(
						mapToArray(
								siliconPackages.reduce((acc, p) => {
									Object.entries(p.silicon.interrupts || {}).forEach(([k, v]) => acc[k] = v);
									return acc;
								}, {})
								)
						);


				let buildCpp = codeGen();

				buildCpp.wl("#include <stdlib.h>");

				buildCpp.wl();
				buildCpp.begin("namespace target {");
				buildCpp.begin("namespace interrupts {");
				function writeInterrupts(kind, start, end) {
					buildCpp.begin(`namespace ${kind} {`);
					for (let n = start; n < end; n++) {
						let name = interrupts[n];
						if (name) {
							buildCpp.wl(`const int ${name} = ${n - start};`);
						}
					}
					buildCpp.end("}");
				}
				writeInterrupts("Internal", 0, 15);
				writeInterrupts("External", 15, interrupts.length);
				writeInterrupts("All", 0, interrupts.length);
				buildCpp.end("}");
				buildCpp.end("}");
				buildCpp.wl();

				function addIncludes(packages) {
					packages.forEach(p => {
						(p.silicon.sources || []).forEach(s => {
							buildCpp.wl(`#include "../${p.directory}/${s}"`);
							watched.push(`${p.directory}/${s}`);
						});
					});
				}
				
				addIncludes(siliconPackages.filter(p => p.silicon.target));
				addIncludes(siliconPackages.filter(p => !p.silicon.target));

				let buildCppFile = "build/build.cpp";
				await buildCpp.toFile(buildCppFile);

				let interruptsSFile = "build/interrupts.S";
				let interruptsS = codeGen();
				interruptsS.wl(`.section .text`);
				interruptsS.wl(`.weak fatalError`);
				interruptsS.wl(`fatalError:`);
				interruptsS.wl(`b fatalError`);


				interruptsS.wl(`.section .interrupts`);

				for (let i = 0; i < interrupts.length; i++) {
					let interrupt = interrupts[i];
					let handler = "interruptHandler" + interrupt;
					handler = "_Z" + handler.length + handler + "v";
					if (interrupt) {
						interruptsS.wl(`.weak ${handler}`);
						interruptsS.wl(`.set ${handler}, fatalError`);
						interruptsS.wl(`.word ${handler} + 1`);
					} else {
						interruptsS.wl(".word fatalError + 1");
					}
				}

				interruptsS.toFile(interruptsSFile);

				let imageFile = "build/build.elf";

				let gccParams = [
					"-T", cpu.ldScript,
					"-nostartfiles",
					"--specs=nano.specs",
					"-fshort-wchar",
					"-g",
					"-Og",
					"-std=c++14",
					"-fno-rtti",
					"-fno-exceptions",
					"-ffunction-sections",
					"-fdata-sections",
					...cpu.gccParams,
					...siliconPackages.reduce((acc, p) => {
						return acc.concat(Object.entries(p.silicon.symbols || {}).map(([k, v]) => `-Wl,--defsym,${k}=${v}`));
					}, []),
					"-o", imageFile,
					interruptsSFile,
					cpu.startS,
					buildCppFile
				];

				await run(cpu.gccPrefix + "gcc", ...gccParams);

				if (command.disassembly) {
					await run(cpu.gccPrefix + "objdump", "--section=.text", "-D", imageFile);
				}

				if (command.size) {
					await run(cpu.gccPrefix + "size", imageFile);
				}

				if (command.flash) {

					let connection = new Telnet();
					let port = command.flash === true ? 4444 : parseInt(command.flash);

					await connection.connect({
						port,
						shellPrompt: "> ",
						debug: true
					});

					async function exec(cmd) {
						let res = await connection.exec(cmd);
						console.info(res);
						return res;
					}

					await exec("reset halt");
					await exec("flash write_image erase " + process.cwd() + "/" + imageFile);
					await exec("reset run");

					await connection.end();

				}
			}

			async function watchedChanged() {
				return new Promise((resolve, reject) => {
					console.info("Waiting for a source file change...");
					let watchers = [];
					watched.forEach(file => {
						watchers.push(fs.watch(file, () => {
							watchers.forEach(w => w.close());
							console.info(file, "changed");
							resolve();
						}));
					});
				});
			}
			;

			do {
				try {
					await build();
				} catch (e) {
					if (command.loop) {
						console.error(e);
					} else {
						throw e;
					}
				}
				if (!command.loop) {
					break;
				}
				await watchedChanged();
			} while (true);

		}
	};

};