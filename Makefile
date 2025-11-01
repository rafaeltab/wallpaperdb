.PHONY: infra-start infra-stop infra-reset infra-logs help

help:
	@echo "WallpaperDB - Available commands:"
	@echo ""
	@echo "Infrastructure:"
	@echo "  make infra-start    - Start all infrastructure services"
	@echo "  make infra-stop     - Stop all infrastructure services"
	@echo "  make infra-reset    - Reset all infrastructure data (WARNING: deletes all data)"
	@echo "  make infra-logs     - Tail logs from all infrastructure services"
	@echo ""

infra-start:
	@turbo run start --filter=@wallpaperdb/infra-local

infra-stop:
	@turbo run stop --filter=@wallpaperdb/infra-local

infra-reset:
	@turbo run reset --filter=@wallpaperdb/infra-local

infra-logs:
	@turbo run logs --filter=@wallpaperdb/infra-local
