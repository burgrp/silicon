#!/usr/bin/env node

const loadProject = require("./project.js");
const buildProject = require("./build.js");

let cli = require("commander")
		.option("-C, --directory [directory]", "change to directory", )
		.parse(process.argv);

async function start() {

	let project = await loadProject(cli.directory || ".");
	//console.info(project);

	await buildProject(project);

}


start().catch(console.error);
