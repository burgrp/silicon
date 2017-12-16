function codeGen(level = 0) {
	
	lines = [];
	
	return {
		
		wl(...words) {
			lines.push({
				level,
				string: words.join(" ")
			});
			return this;
		},
		
		begin(...words) {
			this.wl(...words);
			level++;
			return this;
		},
			
		end(...words) {
			level--;
			this.wl(...words);
			return this;
		},
		
		toString() {
			return lines.map(line => " ".repeat(line.level * 2) + line.string).join("\n");
		}
	};
};

module.exports = codeGen;