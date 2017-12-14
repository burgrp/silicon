/* global Promise */

const pro = require("util").promisify;
const fs = require("fs");
const xml2js = require("xml2js");


module.exports = async (svdFile, buildFile) => {

	let svdData = await pro(fs.readFile)(svdFile, "utf8");

	let device = (await pro(new xml2js.Parser().parseString)(svdData)).device;


	if (device.width[0] !== "32") {
		throw "SVD error: device.width is expected to be 32";
	}
	//console.info(device);
	
	let nonDerived = [];
	
	device.peripherals[0].peripheral.forEach(peripheral => {

		if (!(peripheral.$ || {}).derivedFrom) {

			let derived = device.peripherals[0].peripheral.filter(dp => (dp.$ || {}).derivedFrom === peripheral.name[0]);

			let groupName = peripheral.groupName[0];
			
			let typeName;
			if (derived.length > 0) {
				let allNames = derived.map(dp => dp.name[0]).concat(peripheral.name[0]).sort();
				
				if (allNames.some(n => !n.startsWith(groupName))) {
					typeName = allNames[0] + "_" + allNames[allNames.length - 1];
				} else {
					typeName = groupName + "_" + allNames[0].slice(groupName.length) + "_" + allNames[allNames.length - 1].slice(groupName.length);
				}
			} else {
				let name = peripheral.name[0];
				if (name.startsWith(groupName) && name !== groupName) {
					typeName = groupName + "_" + name.slice(groupName.length);
				} else {
					typeName = name;
				}
			}

			nonDerived.push({
				typeName,
				groupName,
				peripheral,
				derived
			});
		}		
	});
	
	nonDerived.forEach(p => {
		if (!nonDerived.some(p2 => p2.groupName === p.groupName && p2 !== p)) {
			p.typeName = p.groupName;
		}
	});
	
	var includes = [];
	
	var writes = nonDerived.map(type => {
		let fileName = "peripheral-" + type.typeName;
		includes.push("/build/" + fileName + ".cpp");
		
		let code = type.typeName;
		
		return pro(fs.writeFile)(buildFile("cpp", fileName), code, "utf8");
	});
	
	await Promise.all(writes);

	return includes;
};