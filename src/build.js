const pro = require("util").promisify;
const fs = require("fs");
const spawn = require("child_process").spawn;
const codeGen = require("./code-gen.js");
const rmDir = require("./rmdir.js");

module.exports = async config => {

	async function run(cmd, ...args) {
		console.info(">", cmd, ...args);
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


	return {
		async init(cli) {
			return cli.command("build")
					.option("-D, --dependencies [dependencies]", "run 'npm install' to update dependencies prior to the build");
		},

		async start(command) {

			let buildDir = "build";

			await rmDir(buildDir);
			await pro(fs.mkdir)(buildDir);

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

			let vectorsSFile = "build/vectors.S";
			let vectorsS = codeGen();
			vectorsS.wl(`.section .vectors`);
			vectorsS.wl(`ui:`);
			for (let i = 0; i < interrupts.length; i++) {
				let interrupt = interrupts[i];

				if (interrupt) {
					//vectorsS.wl(`.ifndef interruptHandler${interrupt}`);
					vectorsS.wl(`.weak interruptHandler${interrupt}`);
					vectorsS.wl(`.set interruptHandler${interrupt}, ui`);
					vectorsS.wl(`.word interruptHandler${interrupt} + 1`);
					//vectorsS.wl(`.endif`);
				} else {
					vectorsS.wl(".word _unhandledInterrupt + 1");
				}
			}

			//console.info(vectorsS.toString());

			vectorsS.toFile(vectorsSFile);

			let imageFile = "build/build.elf";

			let gccParams = [
				"-T", cpu.ldScript,
				"-nostdlib",
				"-O3",
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
				vectorsSFile,
				cpu.startS,
				cppFile
			];

			await run(cpu.gccPrefix + "gcc", ...gccParams);
			await run(cpu.gccPrefix + "objdump", "-D", imageFile);

		}
	};

};