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

					for (dep in package.dependencies) {
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

			/*
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
			 
			 let buildDir = "./build";
			 try {
			 await pro(fs.stat)(buildDir);
			 } catch (e) {
			 if (e.code === "ENOENT") {
			 await pro(fs.mkdir)(buildDir);
			 } else {
			 throw e;
			 }
			 }
			 
			 buildFile = (suffix, baseName) => `${buildDir}/${baseName || "build"}.${suffix}`;
			 
			 let cppCode = "";
			 function ln(...strs) {
			 cppCode += strs.join(" ") + "\n";
			 }
			 
			 ln("#include <stdlib.h>");
			 ln();
			 
			 
			 let defs = {};
			 
			 Object.values(project.packages).forEach(package => {
			 Object.assign(defs, package.defs || {});
			 });
			 
			 Object.entries(defs).forEach(([k, v]) => ln(`#define ${k} ${v}`));
			 ln();
			 
			 let mcu = defs.MCU;
			 if (!mcu) {
			 throw "MCU not defined. Please add MCU property to defs node in your package.json.";
			 }
			 
			 let svd;
			 for (let packageName in project.packages) {
			 let svdFile = (project.packages[packageName].svds || {})[mcu];
			 if (svdFile) {
			 svd = project.packages[packageName].dir + svdFile;
			 break;
			 }
			 }
			 
			 if (!svd) {
			 throw `No SVD defined for ${mcu}`;
			 }
			 
			 let svdSources = await processSvd(project.dir + svd, buildFile);
			 svdSources.concat(project.sources).forEach(s => ln(`#include "..${s}"`));
			 
			 let cppFile = buildFile("cpp");
			 console.info(cppCode);
			 await pro(fs.writeFile)(cppFile, cppCode, "utf8");
			 
			 
			 let elfFile = buildFile("elf");
			 await run("arm-none-eabi-gcc", "-nostdlib", "-O3", "-std=c++14", "-fno-exceptions", "-o", elfFile, cppFile);
			 await run("arm-none-eabi-objdump", "-D", elfFile);
			 */


		}
	}

};