const pro = require("util").promisify;
const fs = require("fs");
const spawn = require("child_process").spawn;

const processSvd = require("./svd.js");

module.exports = async project => {

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

	let buildDir = `${project.dir}/build`;
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

//	let svd = await readSvd(mcu);
//	await createMcuCpp(svd, project.buildFile("cpp", "svd"));

	

	svdSources.concat(project.sources).forEach(s => ln(`#include "..${s}"`));


	let cppFile = buildFile("cpp");
	console.info(cppCode);
	await pro(fs.writeFile)(cppFile, cppCode, "utf8");


	let elfFile = buildFile("elf");
	await run("arm-none-eabi-gcc", "-nostdlib", "-O3", "-std=c++14", "-fno-exceptions", "-o", elfFile, cppFile);
	await run("arm-none-eabi-objdump", "-D", elfFile);

}