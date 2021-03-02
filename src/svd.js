/* global Promise */

const pro = require("util").promisify;
const fs = require("fs");
const xml2js = require("xml2js");
const codeGen = require("./code-gen.js");
const rmDir = require("./rmdir.js");

module.exports = async config => {

	async function parseSvd(svdFile) {
		console.info(`Parsing SVD file ${svdFile}`);
		let svdData = await pro(fs.readFile)(svdFile, "utf8");
		return (await pro(new xml2js.Parser().parseString)(svdData)).device;
	}

	return {
		async init(cli) {
			return cli.command("svd <svdFile> [svdFiles...]");
		},

		async start(command, svdFile, svdFiles) {

			//console.info("Generating sources from", svdFile);

			let device = await parseSvd(svdFile);
			let cpu = (device.cpu || [{ name: [] }])[0].name[0];
			if (!cpu) {
				console.info("Warning: Undefined cpu - assuming CM0");
				cpu = "CM0";
			}

			let otherSvdFiles = await Promise.all([...svdFiles, `${__dirname}/../arm-std-svd/ARM${cpu}.svd`].map(fn => parseSvd(fn)));
			let missingPeripherals = otherSvdFiles.flatMap(device => device.peripherals[0].peripheral).filter(ps => !device.peripherals[0].peripheral.some(pd => pd.name[0] === ps.name[0]));
			device.peripherals[0].peripheral = device.peripherals[0].peripheral.concat(missingPeripherals);

			if (device.width[0] !== "32") {
				throw "SVD error: device.width is expected to be 32";
			}

			let nonDerived = [];

			device.peripherals[0].peripheral.forEach(peripheral => {

				if (!(peripheral.$ || {}).derivedFrom) {

					let derived = device.peripherals[0].peripheral.filter(dp => (dp.$ || {}).derivedFrom === peripheral.name[0]);

					let groupName = (peripheral.groupName || peripheral.name)[0];

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
				return element.description && element.description[0].replace(/[ \r\n]+/g, " ");
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

				function writeTypes(parent, namespace) {

					(parent.cluster || []).forEach(cluster => {
						code.begin(`namespace ${cluster.name} {`);
						writeTypes(cluster, namespace + "::" + cluster.name);
						code.end(`};`);
						code.wl();
					});

					(parent.register || []).forEach(register => {

						let registerName = register.name[0].replace(/[0-9_]*%s/, "");

						let registerSize = svdInt(register.size);
						let registerRawType = {
							8: "char",
							16: "short",
							32: "long"
						}[registerSize];
						if (!registerRawType) {
							throw `Register ${type.peripheral.name}.${register.name[0]} has unsupported size ${registerSize}`;
						}

						// find field vectors, e.g. STM32F GPIO MODER0..MODER15
						let vectors = {};
						(register.fields || [{ field: [] }])[0].field.forEach(f1 => {
							let m1 = f1.name[0].match(/([a-zA-Z]+)([0-9]+)([a-zA-Z]*)_*$/);
							if (m1) {
								let prefix = m1[1];
								let suffix = m1[3];
								register.fields[0].field.forEach(f2 => {
									if (f1 !== f2) {
										let m2 = f2.name[0].match(/([a-zA-Z]+)([0-9]+)([a-zA-Z]*)_*$/);
										if (m2 && m2[1] === prefix && m2[3] === suffix) {
											let i1 = parseInt(m1[2]);
											let i2 = parseInt(m2[2]);
											let min = Math.min(i1, i2);
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
											f1.vector = v;
											f2.vector = v;
										}
									}
								});
							}
						});

						let enums = (register.fields || [{ field: [] }])[0]
							.field
							.filter(field =>
								field.enumeratedValues &&
								field.enumeratedValues.length === 1 &&
								(
									(field.vector && field === field.vector.fields[0]) ||
									!field.vector
								)
							)
							.reduce((acc, field) => ([
								...acc,
								{
									name: field.vector ?
										field.vector.prefix + (field.vector.suffix ? "_" + field.vector.suffix : "") :
										field.name[0],
									values: field.enumeratedValues[0]
										.enumeratedValue
										.reduce((acc, ev) => ({
											...acc,
											[ev.name[0].replace(/^[0-9]+$/, (inlineDescription(ev) || ("_" + ev.name[0])).replace(/[^0-9a-zA-Z]/g, "_").replace(/__*/g, "_").toUpperCase()).replace(/^(?=[0-9])/, "_")]: {
												description: inlineDescription(ev),
												value: ev.value[0]
											}
										}), {}),
									fields: field.vector ? field.vector.fields : [field]
								}
							]), []);

						enums.forEach(e => e.fields.forEach(field => {
							field.enumeration = e;
						}));

						//console.info(register);
						code.wl();
						code.begin("/**");
						code.wl(inlineDescription(register));
						code.end("*/");

						code.begin(`namespace ${registerName} {`);

						enums.forEach(e => {
							code.begin("enum class " + e.name + " {");
							Object.entries(e.values).forEach(([memberName, member]) => {
								if (member.description) {
									code.wl("// " + member.description);
								}
								code.wl(memberName + " = " + member.value + ",");
							});
							code.end("};")
							code.wl();
						});



						code.begin(`class Register {`);

						code.wl("volatile unsigned", registerRawType, "raw;");
						code.wl("public:");

						code.begin("__attribute__((always_inline)) void operator= (unsigned long value) volatile {");
						code.wl("raw = value;");
						code.end("}");
						code.begin("__attribute__((always_inline)) operator unsigned long () volatile {");
						code.wl("return raw;");
						code.end("}");
						code.begin("/**");
						code.wl("Returns copy of the register");
						code.end("*/");
						code.begin("__attribute__((always_inline)) Register copy() volatile {");
						code.wl("Register reg;");
						code.wl("reg.raw = this->raw;");
						code.wl("return reg;");
						code.end("}");
						code.begin("/**");
						code.wl("Returns empty copy of the register");
						code.end("*/");
						code.begin("__attribute__((always_inline)) Register bare() volatile {");
						code.wl("Register reg;");
						code.wl("reg.raw = 0;");
						code.wl("return reg;");
						code.end("}");
						code.begin("/**");
						code.wl("Sets register to zero");
						code.end("*/");
						code.begin("__attribute__((always_inline)) Register& zero() volatile {");
						code.wl("raw = 0;");
						code.wl("return *(Register*)this;")
						code.end("}");

						function writeAccessors(fieldName, bitOffset, bitWidth, description, firstIndex, lastIndex, enumeration) {

							let indexed = firstIndex !== undefined;

							let mask = "0x" + (Math.pow(2, bitWidth) - 1).toString(16).toUpperCase();
							let indexRange = "index in range " + firstIndex + ".." + lastIndex;

							let fieldType;
							let valueRange;

							let getterCast = "";
							let setterCast = "";

							if (enumeration) {
								fieldType = namespace + "::" + registerName + "::" + enumeration.name;
								getterCast = "static_cast<" + fieldType + ">";
								setterCast = "static_cast<unsigned long>";
								valueRange = prolog => {
									code.wl(prolog + " enumeration value:")
									Object.entries(enumeration.values).forEach(([name, value]) => code.wl(fieldType + "::" + name + " (" + value.value + ") " + value.description));
								};
							} else if (bitWidth === 1) {
								fieldType = "bool";
								valueRange = prolog => code.wl(prolog + " boolean value");
							} else {
								fieldType = "unsigned long";
								valueRange = prolog => code.wl(prolog + " value in range 0.." + (Math.pow(2, bitWidth) - 1));
							}

							code.begin("/**");
							code.wl("Gets", description);
							if (indexed) {
								code.wl("@param", indexRange);
							}
							valueRange("@return");
							code.end("*/");
							if (indexed) {
								code.begin("__attribute__((always_inline)) " + fieldType + " get" + fieldName + "(int index) volatile {");
								code.wl("return " + getterCast + "((raw & (" + mask + " << " + bitOffset + ")) >> " + bitOffset + ");");
							} else {
								code.begin("__attribute__((always_inline)) " + fieldType + " get" + fieldName + "() volatile {");
								code.wl("return " + getterCast + "((raw & (" + mask + " << " + bitOffset + ")) >> " + bitOffset + ");");
							}
							code.end("}");

							code.begin("/**");
							code.wl("Sets", description);
							if (indexed) {
								code.wl("@param", indexRange);
							}
							valueRange("@param value");
							code.end("*/");
							if (indexed) {
								code.begin("__attribute__((always_inline)) Register& set" + fieldName + "(int index, " + fieldType + " value) volatile {");
								code.wl("raw = (raw & ~(" + mask + " << " + bitOffset + ")) | (((" + setterCast + "(value)) << " + bitOffset + ") & (" + mask + " << " + bitOffset + "));");								
							} else {
								code.begin("__attribute__((always_inline)) Register& set" + fieldName + "(" + fieldType + " value) volatile {");
								code.wl("raw = (raw & ~(" + mask + " << " + bitOffset + ")) | (((" + setterCast + "(value)) << " + bitOffset + ") & (" + mask + " << " + bitOffset + "));");
							}
							code.wl("return *(Register*)this;")
							code.end("}");
						}

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
								writeAccessors(
									fieldName,
									"(" + firstOffset + " + " + firstDistance + " * (index - " + firstIndex + "))",
									fieldWidth(field),
									inlineDescription(field),
									firstIndex,
									lastIndex,
									field.enumeration
								);
							}

						});

						(register.fields || [{ field: [] }])[0].field.filter(field => !field.inVector).forEach(field => {
							writeAccessors(
								field.name[0].replace(/_$/, ""),
								fieldOffset(field),
								fieldWidth(field),
								inlineDescription(field),
								undefined,
								undefined,
								field.enumeration
							);
						});

						code.end("};"); // class

						code.end("};"); // namespace
					});
				}

				writeTypes(type.peripheral.registers[0], "target::" + type.typeName);

				code.begin("class Peripheral {");
				code.wl("public:");
				code.begin("union {");

				function writeRegisters(parent, typePrefix) {

					(parent.cluster || []).forEach(cluster => {
						code.begin("union {");
						writeRegisters(cluster, `${typePrefix}${cluster.name}::`);
						code.end(`} ${cluster.name};`);
					});

					(parent.register || []).forEach(register => {

						let dim = svdInt(register.dim || [0]);
						let registerSize = svdInt(register.size);
						let dimIncrement = svdInt(register.dimIncrement || [register.size / 8]);

						let registerOffset = svdInt(register.addressOffset);
						let registerName = register.name[0].replace(/[0-9_]*%s/, "");

						code.begin("struct {");
						if (registerOffset > 0) {
							code.wl(`char _space_${registerName}[0x${registerOffset.toString(16)}];`);
						}

						if (dim > 1) {
							code.begin("/**");
							code.wl(inlineDescription(register));
							code.end("*/");
							let space = dimIncrement - registerSize / 8;
							if (space) {
								code.begin("struct {");
								code.wl(`${typePrefix}${registerName}::Register reg;`);
								code.wl(`char _space[${space}];`);
								code.end(`} ${registerName}[${dim}];`);
							} else {
								code.wl(`${typePrefix}${registerName}::Register ${registerName}[${dim}];`);
							}
						} else {
							code.begin("/**");
							code.wl(inlineDescription(register));
							code.end("*/");
							code.wl(`${typePrefix}${registerName}::Register ${registerName};`);
						}

						code.end("};");

					});

				}

				writeRegisters(type.peripheral.registers[0], "");

				code.end("};");
				code.end("};");
				code.end("}");

				code.wl();

				[type.peripheral].concat(type.derived).forEach(p => {
					let symbol = p.name[0].toUpperCase();
					code.wl("extern volatile " + type.typeName + "::Peripheral", symbol + ";");
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
						cpu,
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