/* global __dirname */

module.exports = {
	gccPrefix: "arm-none-eabi-",
	gccParams: [
		"-mcpu=cortex-m0",
		"-mthumb"
	],
	startS: __dirname + "/cortex-m0.S",
	ldScript: __dirname + "/cortex-m0.ld",
	interrupts: {
		"1": "Reset",
		"2": "NMI",
		"3": "HardFault",
		"11": "SVCall",
		"14": "PendSV",
		"15": "SysTick"
	}
};