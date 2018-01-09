/* global Promise */

const pro = require("util").promisify;
const fs = require("fs");
const xml2js = require("xml2js");
const codeGen = require("./code-gen.js");
const rmDir = require("./rmdir.js");

module.exports = async config => {

	return {
		async init(cli) {
			return cli.command("svd <svdFile>");
		},

		async start(command, svdFile) {

			console.info("Generating sources from", svdFile);

			let svdData = await pro(fs.readFile)(svdFile, "utf8");

			let device = (await pro(new xml2js.Parser().parseString)(svdData)).device;

			if (device.width[0] !== "32") {
				throw "SVD error: device.width is expected to be 32";
			}

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
				p.typeName = p.typeName.toLowerCase();
			});

			function svdInt(element) {
				return parseInt(element[0]);
			}

			function inlineDescription(element) {
				return element.description[0].replace(/[ \r\n]+/g, " ");
			}

			function fieldOffset(field) {
				return svdInt(field.bitOffset);
			}

			function fieldWidth(field) {
				return svdInt(field.bitWidth);
			}

			await rmDir("generated");

			await pro(fs.mkdir)("generated");

			var sources = [];
			var symbols = {};

			var writes = nonDerived.map(type => {
				let fileName = "generated/" + type.typeName + ".cpp";
				sources.push(fileName);

				let code = codeGen();

				code.begin("namespace target {");
				code.begin("namespace", type.typeName, "{");

				code.begin("namespace reg {");

				type.peripheral.registers[0].register.forEach(register => {
					
					let registerSize = svdInt(register.size);
					if (registerSize !== 32) {
						throw `Register ${type.peripheral.name}.${register.name[0]} has size ${registerSize}`;
					}
					
					//console.info(register);
					code.wl();
					code.begin("/**");
					code.wl(inlineDescription(register));
					code.end("*/");
					code.begin("class", register.name, "{");


					code.wl("volatile unsigned long raw;");
					code.wl("public:");

					code.begin("__attribute__((always_inline)) void operator= (unsigned long value) volatile {");
					code.wl("raw = value;");
					code.end("}");
					code.begin("__attribute__((always_inline)) operator unsigned long () volatile {");
					code.wl("return raw;");
					code.end("}");

					// find field vectors, e.g. STM32F GPIO MODER0..MODER15

					let vectors = {};
					register.fields[0].field.forEach(f1 => {
						let m1 = f1.name[0].match(/([a-zA-Z]+)([0-9]+)([a-zA-Z]*)$/);
						if (m1) {
							let prefix = m1[1];
							let suffix = m1[3];
							register.fields[0].field.forEach(f2 => {
								if (f1 !== f2) {
									let m2 = f2.name[0].match(/([a-zA-Z]+)([0-9]+)([a-zA-Z]*)$/);
									if (m2 && m2[1] === prefix && m2[3] === suffix) {
										let i1 = parseInt(m1[2]);
										let i2 = parseInt(m2[2]);
										let	min = Math.min(i1, i2);
										let max = Math.max(i1, i2);
										let key = m1[1] + "#" + m1[3];
										let v = vectors[key];
										if (!v) {
											v = {
												min,
												max,
												prefix,
												suffix,
												fields: []
											};
											vectors[key] = v;
										} else {
											v.min = Math.min(v.min, min);
											v.max = Math.max(v.max, max);
										}
										v.fields[i1] = f1;
										v.fields[i2] = f2;
									}
								}
							});
						}
					});

					Object.entries(vectors).forEach(([k, v]) => {

						let firstIsMarked;
						let firstIndex;
						let firstOffset;
						let firstDistance;
						let lastIndex;

						for (let c = 0; c < v.fields.length; c++) {
							let field = v.fields[c];
							if (field) {
								let bitOffset = fieldOffset(field);

								if (firstIndex === undefined) {
									firstIndex = c;
									firstOffset = bitOffset;
								} else {
									if (firstDistance === undefined) {
										firstDistance = bitOffset - firstOffset;
									}
									let expectedOffset = firstOffset + firstDistance * (c - firstIndex);
									if (expectedOffset === bitOffset) {
										if (!firstIsMarked) {
											v.fields[firstIndex].inVector = v;
											firstIsMarked = true;
										}
										field.inVector = v;
										lastIndex = c;
									} else {
										v.fields[c] = undefined;
									}
								}
							}
						}

						if (firstIsMarked) {

							let field = v.fields[firstIndex];

							let fieldName = field.inVector.prefix + (field.inVector.suffix ? "_" + field.inVector.suffix : "");

							let bitOffset = "(" + firstOffset + " + " + firstDistance + " * (index - " + firstIndex + "))"
							let bitWidth = fieldWidth(field);

							let description = inlineDescription(field);
							let indexRange = "index in range " + firstIndex + ".." + lastIndex;
							let valueRange = "value in range 0.." + (Math.pow(2, bitWidth) - 1);
							let mask = "0x" + (Math.pow(2, bitWidth) - 1).toString(16).toUpperCase();

							code.begin("/**");
							code.wl("Gets", description);
							code.wl("@param", indexRange);
							code.wl("@return", valueRange);
							code.end("*/");
							code.begin("__attribute__((always_inline)) unsigned long", "get" + fieldName + "(int index) volatile {");
							code.wl("return (raw & (" + mask + " << " + bitOffset + ")) >> " + bitOffset + ";");
							code.end("}");

							code.begin("/**");
							code.wl("Sets", description);
							code.wl("@param", indexRange);
							code.wl("@param", valueRange);
							code.end("*/");
							code.begin("__attribute__((always_inline)) unsigned long", "set" + fieldName + "(int index, unsigned long value) volatile {");
							code.wl("raw = (raw & ~(" + mask + " << " + bitOffset + ")) | ((value << " + bitOffset + ") & (" + mask + " << " + bitOffset + "));");
							code.end("}");
					}

					});

					register.fields[0].field.filter(field => !field.inVector).forEach(field => {

						let bitOffset = fieldOffset(field);
						let bitWidth = fieldWidth(field);

						let description = inlineDescription(field);
						let range = "value in range 0.." + (Math.pow(2, bitWidth) - 1);
						let mask = "0x" + (Math.pow(2, bitWidth) - 1).toString(16).toUpperCase();

						code.begin("/**");
						code.wl("Gets", description);
						code.wl("@return", range);
						code.end("*/");
						code.begin("__attribute__((always_inline)) unsigned long", "get" + field.name + "() volatile {");
						code.wl("return (raw & (" + mask + " << " + bitOffset + ")) >> " + bitOffset + ";");
						code.end("}");

						code.begin("/**");
						code.wl("Sets", description);
						code.wl("@param", range);
						code.end("*/");
						code.begin("__attribute__((always_inline)) unsigned long", "set" + field.name + "(unsigned long value) volatile {");
						code.wl("raw = (raw & ~(" + mask + " << " + bitOffset + ")) | ((value << " + bitOffset + ") & (" + mask + " << " + bitOffset + "));");
						code.end("}");
					});

					code.end("};");
				});
				code.end("};");

				code.begin("class Peripheral {");
				code.wl("public:");
				code.begin("union {");

				type.peripheral.registers[0].register.forEach(register => {

					let regOffset = svdInt(register.addressOffset);

					code.begin("struct {");
					if (regOffset > 0) {
						code.wl(`volatile char _space_${register.name}[${regOffset}];`);
					}

					code.begin("/**");
					code.wl(inlineDescription(register));
					code.end("*/");
					code.wl(`volatile reg::${register.name} ${register.name};`);

					code.end("};");
				});

				code.end("};");
				code.end("};");

				code.end("}");

				code.wl();

				[type.peripheral].concat(type.derived).forEach(p => {
					let symbol = p.name[0].toUpperCase();
					code.wl("extern " + type.typeName + "::Peripheral", symbol + ";");
					symbols["_ZN6target" + symbol.length + symbol + "E"] = p.baseAddress[0];
				});

				code.end("}");

				return code.toFile(fileName);
			});

			await Promise.all(writes);

			let package = JSON.parse(await pro(fs.readFile)("package.json", "utf8"));

			let interrupts = {};
			device.peripherals[0].peripheral.forEach(p => {
				(p.interrupt || []).forEach(i => {
					interrupts[i.value[0]] = i.name[0];
				});
			});

			Object.assign(package, {
				silicon: {
					target: {
						name: device.name[0],
						cpu: device.cpu[0].name[0]
					},
					sources,
					symbols,
					interrupts
				}
			});

			await pro(fs.writeFile)("package.json", JSON.stringify(package, null, 2));
		}
	};

};