#!/usr/bin/env node

const cli = require("commander");
const appglue = require("@device.farm/appglue");

async function start() {

	cli
			.option("-c, --directory [directory]", "change directory");

	const app = await appglue.load(require);

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
			console.error(e);
			process.exit(1);
		}
	} else {
		cli.help();
		process.exit(1);
	}

}

start().catch(console.error);
