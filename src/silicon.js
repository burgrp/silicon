#!/usr/bin/env node

const pro = require("util").promisify;
const fs = require("fs");
const spawn = require("child_process").spawn;

async function createProject(dir) {

	let packages = {};
	let sources = [];
	let defs = {};

	async function include(dir) {

		let package = JSON.parse(await pro(fs.readFile)(dir + "/package.json", "utf8"));

		if (packages[package.name]) {

			if (package.version !== packages[package.name].version) {
				throw `${package.name} versions conflict ${package.version} ${packages[package.name].version}`;
			}

		} else {

			packages[package.name] = package;

			for (dep in package.dependencies) {
				await include(`${dir}/node_modules/${dep}`);
			}

			defs[`HAS_${package.name.toUpperCase().replace("/", "_").replace("@", "")}`] = `"${package.version}"`;
			Object.assign(defs, package.defs);

			(package.sources || []).forEach(s => sources.push(`${dir}/${s}`));

		}
	}

	await include(dir);

	return {
		packages,
		sources,
		defs,
		dir
	};
}

async function createBuildDir(project) {

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

	project.buildFile = (suffix, baseName) => `${buildDir}/${baseName || "build"}.${suffix}`;
}

async function readSvd(name) {
}

async function createMcuCpp(svd, path) {
	await pro(fs.writeFile)(path, "", "utf8");
}

async function createRootCpp(project) {

	let code = "";
	function ln(...strs) {
		code += strs.join(" ") + "\n";
	}

	ln("#include <stdlib.h>");
	ln();

	Object.entries(project.defs).forEach(([k, v]) => ln(`#define ${k} ${v}`));
	ln();

	let mcu = project.defs.MCU;
	if (!mcu) {
		throw "MCU not defined. Please add MCU property to defs node in your package.json.";
	}

	let svd = await readSvd(mcu);
	await createMcuCpp(svd, project.buildFile("cpp", "svd"));

	ln(`#include "svd.cpp"`);
	project.sources.forEach(s => ln(`#include "..${s.slice(project.dir.length)}"`));

	console.info(code);
	await pro(fs.writeFile)(project.buildFile("cpp"), code, "utf8");
}

async function build(project) {

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

	await run("arm-none-eabi-gcc", "-nostdlib", "-fno-exceptions",	"-o", project.buildFile("elf"), project.buildFile("cpp"));
	
	await run("arm-none-eabi-objdump", "-D", project.buildFile("elf"));

}

let cli = require("commander")
		.option("-C, --directory [directory]", "change to directory", )
		.parse(process.argv);

async function start() {

	let project = await createProject(cli.directory || ".");

	await createBuildDir(project);

	await createRootCpp(project);

	await build(project);

	//console.info(project);

}


start().catch(console.error);
