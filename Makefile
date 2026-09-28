.PHONY: all install uninstall check pack clean locale translate

all: check

locale:
	@./bin/locale

translate:
	@./bin/translate

install: locale
	@sudo ./install.sh --install

uninstall:
	@sudo ./install.sh --uninstall

check: locale
	@echo "Checking shell scripts..."
	@bash -n bin/sylepsign bin/helper bin/locale bin/translate install.sh
	@echo "Checking GJS syntax..."
	@gjs -m daemon/pool.js 2>&1 | grep -v "imports" || true
	@node -c ext/prefs.js ext/ui/*.js
	@echo "Syntax check passed."

pack: locale check
	@mkdir -p dist/sylepsign
	@cp -r bin config daemon ext po schemas systemd install.sh Makefile README.md dist/sylepsign/
	@tar -czf dist/sylepsign.tar.gz -C dist sylepsign
	@rm -rf dist/sylepsign
	@echo "Release archive created at dist/sylepsign.tar.gz"

clean:
	@rm -rf dist/ ext/locale
