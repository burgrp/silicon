const pro = require("util").promisify;
const fs = require("fs");

module.exports = async projectDir => {

	let project = {
		packages: {},
		sources: [],
		dir: projectDir
	};

	async function include(subDir) {

		let package = JSON.parse(await pro(fs.readFile)(`${projectDir}${subDir}/package.json`, "utf8"));

		if (project.packages[package.name]) {

			if (package.version !== project.packages[package.name].version) {
				throw `${package.name} versions conflict ${package.version} ${project.packages[package.name].version}`;
			}

		} else {

			project.packages[package.name] = package;

			for (dep in package.dependencies) {
				await include(`${subDir}node_modules/${dep}/`);
			}

			package.dir = subDir;
			
			(package.sources || []).forEach(s => project.sources.push(`${subDir}${s}`));

		}
	}

	await include("/");

	return project;

};