const pro = require("util").promisify;
const fs = require("fs");
const spawn = require("child_process").spawn;
const codeGen = require("./code-gen.js");
const rmDir = require("./rmdir.js");

module.exports = async config => {

	async function run(cmd, ...args) {
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
				console.info("Scanning", directory);

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

			let forPackages = cb => Object.values(packages).filter(p => p.silicon).forEach(cb);

			forPackages(p => {
				(p.silicon.sources || []).forEach(s => {
					code.wl(`#include "../${p.directory}/${s}"`);
				});
			});

			console.info(code.toString());
			let cppFile = "build/build.cpp";
			await code.toFile(cppFile);

			let imageFile = "build/build.elf";
			await run("arm-none-eabi-gcc", "-nostdlib", "-O3", "-std=c++14", "-fno-exceptions", "-o", imageFile, cppFile);
			await run("arm-none-eabi-objdump", "-D", imageFile);

		}
	};

};