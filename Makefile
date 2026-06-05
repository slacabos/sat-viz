.PHONY: dev build start test lint format install clean

dev:
	npm run dev

install:
	npm install

build:
	npm run build

start:
	npm run start

test:
	npm test

lint:
	npm run lint

format:
	npm run format --workspace=client

clean:
	rm -rf node_modules client/node_modules server/node_modules client/dist server/dist
