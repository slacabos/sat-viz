.PHONY: up dev valkey down build start test lint format install clean

up: valkey
	npm run dev

dev:
	npm run dev

valkey:
	docker compose up -d valkey

down:
	docker compose down

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
