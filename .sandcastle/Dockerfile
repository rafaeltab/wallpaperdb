FROM node:22-bookworm

# Install system dependencies, GitHub CLI, Docker CLI, and Make.
RUN apt-get update && apt-get install -y \
  ca-certificates \
  curl \
  git \
  gnupg \
  jq \
  make \
  && rm -rf /var/lib/apt/lists/*

# Install Docker CLI and Compose plugin from Docker's apt repository so
# `make ci`, Testcontainers, `make infra-start`, and `make dev` can reach the
# host/LXD daemon through DOCKER_HOST=tcp://127.0.0.1:2375.
RUN install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
  && chmod a+r /etc/apt/keyrings/docker.asc \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
    > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y docker-ce-cli docker-compose-plugin \
  && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI.
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

# Build-args for UID/GID alignment: sandcastle docker build-image defaults
# these to the host user's UID/GID so generated files match the bind mount owner.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's "node" user to "agent" and align UID/GID.
RUN groupmod -o -g $AGENT_GID node \
  && usermod -o -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node

# Keep browser binaries in the default non-root Playwright cache location. Turbo
# does not pass arbitrary env through to tasks, so using the default path keeps
# E2E working even if PLAYWRIGHT_BROWSERS_PATH is filtered.
ENV PLAYWRIGHT_BROWSERS_PATH=/home/agent/.cache/ms-playwright

# Install OpenCode CLI, Turborepo, Playwright Chromium, and enable Corepack/Pnpm.
RUN npm install -g opencode-ai@1.15.13 turbo \
  && npx -y playwright@1.59.1 install --with-deps chromium \
  && chown -R $AGENT_UID:$AGENT_GID /home/agent/.cache \
  && corepack enable \
  && mkdir -p /home/agent/.local/share/opencode /home/agent/.config/opencode \
  && chown -R $AGENT_UID:$AGENT_GID /home/agent/.local /home/agent/.config

USER ${AGENT_UID}:${AGENT_GID}
ENV PATH="/home/agent/.local/bin:/home/agent/.local/share/pnpm:$PATH"

WORKDIR /home/agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at
# ${SANDBOX_REPO_DIR} and overrides the working directory to that path.
ENTRYPOINT ["sleep", "infinity"]
