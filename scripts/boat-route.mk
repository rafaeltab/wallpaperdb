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

.PHONY: boat-enroll boat-status boat-stop boat-delete boat-preview boat-settle boat-test boat-cache
boat-enroll: boat-bootstrap ## Enroll this isolated worktree (MODE=validation/development; SIZE=large; COHORT=smoke)
	@node scripts/boat.mjs enroll "$(or $(MODE),validation)" "$(or $(SIZE),large)" "$(or $(COHORT),smoke)"
boat-status: ## Show this enrolled worker and experiment accounting
	@node scripts/boat.mjs status
boat-stop: ## Stop only this enrolled worker
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
boat-await: ## Wait for coordinator enrollment before measured implementation
	@while [ ! -f .boat/launch-ready ]; do sleep 1; done
.PHONY: boat-bootstrap
boat-bootstrap: ## Install the checksum-pinned prototype Boat CLI privately
	@sh scripts/boat-bootstrap.sh
