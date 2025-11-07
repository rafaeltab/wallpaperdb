import {
    createNatsContainer,
    type NatsContainerOptions,
    type StartedNatsContainer,
} from "@wallpaperdb/testcontainers";
import { connect, type StreamConfig } from "nats";
import { type AddMethodsType, BaseTesterBuilder } from "../framework.js";
import type { DockerTesterBuilder } from "./DockerTesterBuilder.js";

export interface NatsOptions {
    image?: string;
    jetStream?: boolean;
    networkAlias?: string;
}

class NatsBuilder {
    private image = "nats:2.10-alpine";
    private enableJetStream = false;
    private networkAlias = "nats";

    withImage(image: string) {
        this.image = image;
        return this;
    }

    withJetstream() {
        this.enableJetStream = true;
        return this;
    }

    withNetworkAlias(alias: string) {
        this.networkAlias = alias;
        return this;
    }

    build(): NatsOptions {
        return {
            image: this.image,
            jetStream: this.enableJetStream,
            networkAlias: this.networkAlias,
        };
    }
}

export interface NatsConfig {
    container: StartedNatsContainer;
    endpoint: string;
    options: NatsOptions;
    streams: string[];
}

export class NatsTesterBuilder extends BaseTesterBuilder<
    "nats",
    [DockerTesterBuilder]
> {
    name = "nats" as const;

    addMethods<TBase extends AddMethodsType<[DockerTesterBuilder]>>(Base: TBase) {
        const desiredStreams: string[] = [];
        return class Nats extends Base {
            nats: NatsConfig | undefined;
            withStream(name: string) {
                desiredStreams.push(name);
                return this;
            }

            withNats(configure: (nats: NatsBuilder) => NatsBuilder = (a) => a) {
                const options = configure(new NatsBuilder()).build();
                const {
                    image = "nats:2.10-alpine",
                    jetStream = true,
                    networkAlias = "nats",
                } = options;

                this.addSetupHook(async () => {
                    console.log("Starting NATS container...");

                    // Auto-detect if network is available
                    const dockerNetwork = this.docker.network;

                    const containerOptions: NatsContainerOptions = {
                        image,
                        enableJetStream: jetStream,
                    };

                    if (dockerNetwork) {
                        containerOptions.network = dockerNetwork;
                        containerOptions.networkAliases = [networkAlias];
                    }

                    const started = await createNatsContainer(containerOptions);

                    const host = dockerNetwork ? networkAlias : undefined;
                    const url = started.getConnectionUrl(host);

                    this.nats = {
                        container: started,
                        endpoint: url,
                        options: options,
                        streams: [],
                    };

                    // Create JetStream stream if specified
                    if (jetStream && desiredStreams.length > 0) {
                        const nc = await connect({ servers: started.getConnectionUrl() });
                        const jsm = await nc.jetstreamManager();

                        for (const stream of desiredStreams) {
                            const streamConfig: Partial<StreamConfig> = {
                                name: stream,
                                subjects: [`${stream.toLowerCase()}.*`],
                            };

                            try {
                                await jsm.streams.add(streamConfig);
                                this.nats?.streams.push(stream);
                                console.log(`Created NATS stream: ${stream}`);
                            } catch (error) {
                                if (!(error as Error).message.includes("already exists")) {
                                    throw error;
                                }
                            }
                        }

                        await nc.close();
                    }

                    console.log(`NATS started: ${url}`);
                });

                this.addDestroyHook(async () => {
                    if (this.nats) {
                        console.log("Stopping NATS container...");
                        await this.nats.container.stop();
                    }
                });

                return this;
            }

            getNats() {
                if (!this.nats) {
                    throw new Error(
                        "NATS not initialized. Call withNats() and setup() first.",
                    );
                }
                return this.nats;
            }
        };
    }
}
