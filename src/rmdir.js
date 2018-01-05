const pro = require("util").promisify;
const fs = require("fs");

async function rmDir(dir, contentOnly = false) {
	try {
		
		let files = await pro(fs.readdir)(dir);
		for (let file of files) {
			let filePath = dir + "/" + file;
			let stat = await pro(fs.stat)(filePath);
			if (stat.isDirectory()) {
				await rmDir(filePath);
			} else {
				await pro(fs.unlink)(filePath);
			}
		}
		
		if (!contentOnly) {
			await pro(fs.rmdir)(dir);
		}
		
	} catch (e) {
		if (e.code !== "ENOENT") {
			throw e;
		}
}
}

module.exports = rmDir;