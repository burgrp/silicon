/* global Promise */

const pro = require("util").promisify;
const fs = require("fs");
const xml2js = require("xml2js");
const codeGen = require("./code-gen.js");
const rmDir = require("./rmdir.js");

module.exports = async config => {

	return {
		async init(cli) {
			return cli.command("version");
		},

		async start(command) {

			console.info(require(__dirname + "/../package.json").version);
		}
	};

};