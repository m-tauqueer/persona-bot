.PHONY: infra-up infra-down infra-reset infra-ps smoke migrate

infra-up:
	docker compose -f infra/compose.yaml --env-file .env up -d --wait

infra-down:
	docker compose -f infra/compose.yaml --env-file .env down

infra-reset:
	docker compose -f infra/compose.yaml --env-file .env down -v
	docker compose -f infra/compose.yaml --env-file .env up -d --wait

infra-ps:
	docker compose -f infra/compose.yaml --env-file .env ps

smoke:
	npm run smoke

migrate:
	npm run migrate
