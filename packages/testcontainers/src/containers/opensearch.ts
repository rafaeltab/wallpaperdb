import {
  AbstractStartedContainer,
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';
import zxcvbn from 'zxcvbn';

const OPENSEARCH_HTTP_PORT = 9200;
const OPENSEARCH_TRANSPORT_PORT = 9300;
const OPENSEARCH_PERFORMANCE_ANALYZER_PORT = 9600;

export class OpenSearchContainer extends GenericContainer {
  // default to security on, with a strong demo password
  private securityEnabled = true;
  private password = 'yourStrong(!)P@ssw0rd';
  private readonly username = 'admin';

  // HTTP(S) + Basic Auth wait strategy
  private get defaultWaitStrategy() {
    let strategy = Wait.forHttp('/', OPENSEARCH_HTTP_PORT).withBasicCredentials(
      this.username,
      this.password
    );
    if (this.securityEnabled) {
      strategy = strategy.usingTls().allowInsecure();
    }

    return strategy;
  }

  /**
   * Toggle OpenSearch security plugin on/off.
   */
  public withSecurityEnabled(enabled: boolean): this {
    this.securityEnabled = enabled;
    return this;
  }

  /**
   * Override the 'admin' password.
   * Enforces OpenSearch’s requirement of zxcvbn score ≥ 3
   */
  public withPassword(password: string): this {
    const { score } = zxcvbn(password);
    if (score < 3) {
      throw new Error(
        `Password "${password}" is too weak (zxcvbn score ${score}). Must score ≥ 3 to meet OpenSearch security requirements.`
      );
    }

    this.password = password;
    return this;
  }

  /**
   * Start the container, injecting the initial-admin-password env var,
   * then wrap in our typed StartedOpenSearchContainer.
   */
  public override async start(): Promise<StartedOpenSearchContainer> {
    this.withExposedPorts(
      OPENSEARCH_HTTP_PORT,
      OPENSEARCH_TRANSPORT_PORT,
      OPENSEARCH_PERFORMANCE_ANALYZER_PORT
    )
      .withEnvironment({
        'discovery.type': 'single-node',
        // disable security plugin if requested
        'plugins.security.disabled': (!this.securityEnabled).toString(),
        OPENSEARCH_INITIAL_ADMIN_PASSWORD: this.password,
      })
      .withStartupTimeout(120_000)
      .withWaitStrategy(this.defaultWaitStrategy);

    const started = await super.start();
    return new StartedOpenSearchContainer(
      started,
      this.username,
      this.password,
      this.securityEnabled
    );
  }
}

export class StartedOpenSearchContainer extends AbstractStartedContainer {
  constructor(
    override readonly startedTestContainer: StartedTestContainer,
    private readonly username: string,
    private readonly password: string,
    private readonly securityEnabled: boolean
  ) {
    super(startedTestContainer);
  }

  /** Mapped HTTP(S) port */
  public getPort(from: 'host' | 'directIp'): number {
    return from === 'host' ? this.getMappedPort(OPENSEARCH_HTTP_PORT) : OPENSEARCH_HTTP_PORT;
  }

  /** HTTP(S) endpoint URL */
  public getHttpUrl(from: 'host' | 'directIp'): string {
    const host = from === 'host' ? this.getHost() : this.getIpAddress('bridge');

    return `${this.getSchema()}://${host}:${this.getPort(from)}`;
  }

  public getSchema() {
    return this.securityEnabled ? 'https' : 'http';
  }

  /** Admin username (always 'admin' by default) */
  public getUsername(): string {
    return this.username;
  }

  /** Admin password */
  public getPassword(): string {
    return this.password;
  }
}
