# NATS stream setup

Run `make nats-setup-streams` after starting infrastructure and when upgrading an existing installation. The operation updates retention age in place without deleting streams or their retained messages.

Wallpaper and Profile source history must remain available for replay. The former one-year wallpaper limit can already have expired events; removing that limit cannot recover them. Unlimited age is provisional until the cross-application retention review in [issue #162](https://github.com/rafaeltab/wallpaperdb/issues/162).

Read the [service recovery guide](../../../apps/docs/content/docs/guides/service-upgrades.mdx) before changing message limits, replacing a durable consumer, or replaying source history. Stream definitions live in [setup-streams.sh](setup-streams.sh); do not maintain a second copy here.
