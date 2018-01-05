const pro = require("util").promisify;
const fs = require("fs");
const spawn = require("child_process").spawn;
const codeGen = require("./code-gen.js");
const rmDir = require("./rmdir.js");

module.exports = async config => {

	return {
		async init(cli) {
			return cli.command("build")
					.option("-v, --verbose", "be verbose, display commands being run")
					.option("-d, --dependencies [dependencies]", "run 'npm install' to update dependencies prior to the build")
					.option("-a, --disassembly", "run 'objdump' to disassembly the image after build")
					.option("-s, --size", "run 'size' to display image size after build")
					.option("-f, --flash [port]", "flash the image using given port")
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

			let buildDir = "build";

			await rmDir(buildDir, true);
			try {
				await pro(fs.mkdir)(buildDir);
			} catch (e) {
				if (e.code !== "EEXIST") {
					throw e;
				}
			}

			let code = codeGen();

			code.wl("#include <stdlib.h>");

			if (command.dependencies) {
				await run("npm", "install");
			}

			let packages = {};

			async function scan(directory) {
				//console.info("Scanning", directory);

				let package = JSON.parse(await pro(fs.readFile)(directory + "/package.json", "utf8"));

				if (packages[package.name]) {

					if (package.version !== packages[package.name].version) {
						throw `${package.name} version conflict ${package.version} ${packages[package.name].version}`;
					}

				} else {

					package.directory = directory;

					for (let dep in package.dependencies) {
						await scan(directory + "/node_modules/" + dep);
					}

					packages[package.name] = package;
				}

			}

			await scan(".");

			let siliconPackages = Object.values(packages).filter(p => p.silicon);

			siliconPackages.forEach(p => {
				(p.silicon.sources || []).forEach(s => {
					code.wl(`#include "../${p.directory}/${s}"`);
				});
			});

			let cppFile = "build/build.cpp";
			await code.toFile(cppFile);

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
				"-nostdlib",
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
				cppFile
			];

			await run(cpu.gccPrefix + "gcc", ...gccParams);

			if (command.disassembly) {
				await run(cpu.gccPrefix + "objdump", "--section=.text", "-D", imageFile);
			}

			if (command.size) {
				await run(cpu.gccPrefix + "size", imageFile);
			}

		}
	};

};