#!/usr/bin/env node

const cli = require("commander");
const appglue = require("@device.farm/appglue");

appglue({ require, file: __dirname + "/../config.json" }).main(async app => {

	cli
		.option("-c, --directory [directory]", "change directory");

	let commandToRun;

	for (let module of app.commands) {
		let commands = await module.init(cli);
		if (!(commands instanceof Array)) {
			commands = [commands];
		}
		for (let command of commands) {
			command.action((...args) => {
				commandToRun = async () => {
					await module.start(command, ...args);
				};
			});
		}
	}

	cli.parse(process.argv);
	if (cli.directory) {
		process.chdir(cli.directory);
	}

	if (commandToRun) {
		try {
			await commandToRun();
		} catch (e) {
			console.error(e.stack || e);
			process.exit(1);
		}
	} else {
		cli.help();
		process.exit(1);
	}

});



