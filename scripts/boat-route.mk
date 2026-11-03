# Enrollment is private and per worktree; task implementations stay in Makefile.
# A recursive Make in the worker uses the original definitions without this overlay.
ifneq ($(wildcard .boat/enrollment.json),)
ifeq ($(filter local worker,$(BOAT_EXEC)),)
boat_validation := $(shell node --input-type=module -e 'import {validation} from "./scripts/lib/boat.mjs"; console.log(validation.join(" "))')
boat_development := $(shell node --input-type=module -e 'import {development} from "./scripts/lib/boat.mjs"; console.log(development.join(" "))')
boat_mode := $(shell node -p 'JSON.parse(require("fs").readFileSync(".boat/enrollment.json")).mode')
boat_targets := $(boat_validation) $(if $(filter development,$(boat_mode)),$(boat_development))
boat_local_run := $(filter format% dev:configure boat:cache-login check:pr-history,$(SCRIPT)) $(if $(filter validation,$(boat_mode)),$(filter dev% start% stop% db:migrate%,$(SCRIPT)))
ifneq ($(strip $(boat_local_run)),)
boat_targets := $(filter-out run,$(boat_targets))
endif
ifeq ($(BOAT_EXEC),remote)
boat_targets += $(filter-out boat-% help install toolchain worktree-remove,$(MAKECMDGOALS))
endif
boat_routed_goals := $(filter $(boat_targets),$(MAKECMDGOALS))
ifneq ($(strip $(boat_routed_goals)),)
ifneq ($(filter-out $(boat_targets),$(MAKECMDGOALS)),)
$(error Use separate Make invocations for local and remote targets)
endif
endif
endif
endif

.PHONY: boat-enroll boat-prepare-toolchain boat-prepare-infra-images boat-status boat-stop boat-delete boat-preview boat-settle boat-test boat-cache
boat-enroll: boat-bootstrap ## Enroll this isolated worktree (MODE=validation/development; SIZE=large; COHORT=smoke; LIFECYCLE=snapshot/fresh-after-stop)
	@node scripts/boat.mjs enroll "$(or $(MODE),validation)" "$(or $(SIZE),large)" "$(or $(COHORT),smoke)" "$(or $(LIFECYCLE),snapshot)"
boat-prepare-toolchain: ## Prepare only this enrolled worker's locked tools, without dependencies or applications
	@node scripts/boat.mjs command -- boat-prepare-toolchain
boat-prepare-infra-images: ## Acquire and verify default infrastructure images without starting containers
ifeq ($(BOAT_EXEC),worker)
	@node scripts/boat.mjs prepare-infra-images "$(COMPOSE_PROJECT_NAME)"
else
	@node scripts/boat.mjs command -- boat-prepare-infra-images
endif
boat-status: ## Show this enrolled worker and experiment accounting
	@node scripts/boat.mjs status
boat-stop: ## Stop only this enrolled worker (optional BOAT_EXPECTED_WORKER_ID and BOAT_EXPECTED_ADMISSION guards)
	@node scripts/boat.mjs stop
boat-delete: ## Delete only this enrolled worker at worktree teardown
	@node scripts/boat.mjs delete
boat-preview: ## Open a private localhost proxy to healthy remote ingress
	@node scripts/boat.mjs preview
boat-settle: ## T3 settle fallback (requires exclusive owner assertion)
	@node scripts/boat.mjs settle
boat-test: ## Run prototype orchestration tests locally
	@$(MAKE) run PACKAGE=scripts SCRIPT=test:boat BOAT_EXEC=local
boat-cache: ## Start the private cohort cache gateway without a worker
	@node scripts/boat.mjs cache
.PHONY: boat-await
.PHONY: boat-sample
boat-sample: ## Collect aligned read-only host, worker and application samples (ARGS=inventory output)
	@node scripts/boat-sample.mjs $(ARGS)
boat-await: ## Wait for coordinator enrollment before measured implementation
	@while [ ! -f .boat/launch-ready ]; do sleep 1; done
.PHONY: boat-bootstrap
boat-bootstrap: ## Install the checksum-pinned prototype Boat CLI privately
	@sh scripts/boat-bootstrap.sh

.PHONY: boat-hillclimb-547
boat-hillclimb-547: ## Execute the fixed #547 Asset baseline with continuous acceptance (BOAT_HILLCLIMB_CONFIG=JSON path)
	@node scripts/boat-hillclimb.mjs
