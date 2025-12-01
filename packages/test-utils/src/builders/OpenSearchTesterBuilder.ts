import {
    OpenSearchContainer,
    type StartedOpenSearchContainer,
} from "@testcontainers/opensearch";
import {
    type AddMethodsType,
    BaseTesterBuilder,
    type TesterInstance,
} from "../framework.js";
import type { CleanupTesterBuilder } from "./CleanupTesterBuilder.js";
import type { DestroyTesterBuilder } from "./DestroyTesterBuilder.js";
import type { DockerTesterBuilder } from "./DockerTesterBuilder.js";
import type { SetupTesterBuilder } from "./SetupTesterBuilder.js";

export interface OpenSearchOptions {
    image?: string;
    networkAlias?: string;
}

class OpenSearchBuilder {
    private image = "opensearchproject/opensearch:2";
    private networkAlias = "opensearch";

    withImage(image: string) {
        this.image = image;
        return this;
    }

    withNetworkAlias(alias: string) {
        this.networkAlias = alias;
        return this;
    }

    build(): OpenSearchOptions {
        return {
            image: this.image,
            networkAlias: this.networkAlias,
        };
    }
}

export interface OpenSearchConfig {
    container: StartedOpenSearchContainer;
    endpoint: {
        networked: string;
        fromHost: string;
        fromHostDockerInternal: string;
        directIp: string;
    };
    host: {
        networked: string;
        fromHost: string;
        fromHostDockerInternal: string;
        directIp: string;
    };
    port: {
        networked: string;
        fromHost: string;
        fromHostDockerInternal: string;
        directIp: string;
    };
    password: string;
    username: string;
    options: OpenSearchOptions;
}

/**
 * Helper class providing namespaced OpenSearch operations.
 */
class OpenSearchHelpers {
    constructor(private tester: TesterInstance<OpenSearchTesterBuilder>) { }

    /**
     * Get the OpenSearch configuration.
     * @throws Error if OpenSearch not initialized
     */
    get config(): OpenSearchConfig {
        const config = this.tester._openSearchConfig;
        if (!config) {
            throw new Error(
                "OpenSearch not initialized. Call withOpenSearch() and setup() first.",
            );
        }
        return config;
    }

    /**
     * Get the OpenSearch configuration.
     */
    tryGetConfig(): OpenSearchConfig | undefined {
        return this.tester._openSearchConfig;
    }
}

export class OpenSearchTesterBuilder extends BaseTesterBuilder<
    "opensearch",
    [
        DockerTesterBuilder,
        SetupTesterBuilder,
        DestroyTesterBuilder,
        CleanupTesterBuilder,
    ]
> {
    name = "opensearch" as const;

    addMethods<
        TBase extends AddMethodsType<
            [
                DockerTesterBuilder,
                SetupTesterBuilder,
                DestroyTesterBuilder,
                CleanupTesterBuilder,
            ]
        >,
    >(Base: TBase) {
        return class OpenSearch extends Base {
            /** @internal */
            _openSearchConfig: OpenSearchConfig | undefined;
            readonly opensearch = new OpenSearchHelpers(
                this as TesterInstance<OpenSearchTesterBuilder>,
            );

            withOpenSearch(
                configure: (opensearch: OpenSearchBuilder) => OpenSearchBuilder = (a) =>
                    a,
            ) {
                const options = configure(new OpenSearchBuilder()).build();
                const {
                    image = "opensearchproject/opensearch:2",
                    networkAlias = "opensearch",
                } = options;

                this.addSetupHook(async () => {
                    console.log("Starting OpenSearch container...");

                    // Auto-detect if network is available
                    const dockerNetwork = this.docker.network;

                    let container = new OpenSearchContainer(image).withSecurityEnabled(
                        false,
                    );

                    if (dockerNetwork) {
                        container = container
                            .withNetwork(dockerNetwork)
                            .withNetworkAliases(networkAlias);
                    }

                    const started = await container.start();

                    const ip = started.getIpAddress("bridge");
                    const host = {
                        networked: networkAlias,
                        fromHost: started.getHost(),
                        fromHostDockerInternal: "host.docker.internal",
                        directIp: ip,
                    };
                    const port = {
                        networked: "9200",
                        fromHost: started.getPort().toString(),
                        fromHostDockerInternal: started.getPort().toString(),
                        directIp: "9200",
                    };

                    const endpoint = {
                        networked: `http://${host.networked}:${port.networked}`,
                        fromHost: `http://${host.fromHost}:${port.fromHost}`,
                        fromHostDockerInternal: `http://${host.fromHostDockerInternal}:${port.fromHostDockerInternal}`,
                        directIp: `http://${host.directIp}:${port.directIp}`,
                    };

                    this._openSearchConfig = {
                        container: started,
                        endpoint: endpoint,
                        host: host,
                        port: port,
                        options: options,
                        password: started.getPassword(),
                        username: started.getUsername(),
                    };

                    console.log(
                        `OpenSearch started: ${endpoint.networked} (internal) ${endpoint.fromHost} (from host)`,
                    );
                });

                this.addDestroyHook(async () => {
                    if (this._openSearchConfig) {
                        console.log("Stopping OpenSearch container...");
                        await this._openSearchConfig.container.stop();
                    }
                });

                return this;
            }
        };
    }
}
