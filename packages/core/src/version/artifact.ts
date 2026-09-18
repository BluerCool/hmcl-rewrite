/**
 * Maven-style artifact coordinates, mirroring HMCL's `Artifact`.
 *
 * Descriptor format: `group:artifact:version[:classifier][@extension]`.
 */
export class Artifact {
  readonly group: string;
  readonly name: string;
  readonly version: string;
  readonly classifier: string | undefined;
  readonly extension: string;

  /** File name, e.g. `guava-17.0.jar`. */
  readonly fileName: string;
  /** Repository-relative path, e.g. `com/google/guava/guava/17.0/guava-17.0.jar`. */
  readonly path: string;
  /** Canonical descriptor string. */
  readonly descriptor: string;

  constructor(descriptor: string);
  constructor(
    group: string,
    name: string,
    version: string,
    classifier?: string,
    extension?: string
  );
  constructor(
    groupOrDescriptor: string,
    name?: string,
    version?: string,
    classifier?: string,
    extension?: string
  ) {
    if (name === undefined || version === undefined) {
      const parsed = Artifact.parse(groupOrDescriptor);
      this.group = parsed.group;
      this.name = parsed.name;
      this.version = parsed.version;
      this.classifier = parsed.classifier;
      this.extension = parsed.extension;
    } else {
      this.group = groupOrDescriptor;
      this.name = name;
      this.version = version;
      this.classifier = classifier;
      this.extension = extension ?? 'jar';
    }

    const base = `${this.name}-${this.version}`;
    const withClassifier =
      this.classifier !== undefined ? `${base}-${this.classifier}` : base;
    this.fileName = `${withClassifier}.${this.extension}`;
    this.path = `${this.group.replace(/\./g, '/')}/${this.name}/${this.version}/${this.fileName}`;
    this.descriptor =
      this.classifier !== undefined
        ? `${this.group}:${this.name}:${this.version}:${this.classifier}`
        : `${this.group}:${this.name}:${this.version}`;
  }

  /** Parses a maven descriptor, tolerating `\` separators and `@ext` suffixes. */
  static parse(descriptor: string): {
    group: string;
    name: string;
    version: string;
    classifier: string | undefined;
    extension: string;
  } {
    const normalized = descriptor.replaceAll('\\', '/');
    let extension = 'jar';
    const at = normalized.lastIndexOf('@');
    let body = normalized;
    if (at >= 0) {
      extension = normalized.slice(at + 1);
      body = normalized.slice(0, at);
    }
    const parts = body.split(':');
    if (parts.length < 3) {
      throw new Error(`Invalid artifact descriptor: ${descriptor}`);
    }
    return {
      group: parts[0]!,
      name: parts[1]!,
      version: parts[2]!,
      classifier: parts.length > 3 && parts[3] !== '' ? parts[3] : undefined,
      extension
    };
  }
}
