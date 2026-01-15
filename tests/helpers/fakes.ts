export type RegisteredTool = {
  name: string;
  description: string;
  schema: any;
  annotations?: {
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    readOnlyHint?: boolean;
    openWorldHint?: boolean;
  };
  handler: (args: any) => Promise<any> | any;
};

export function createFakeMcpServer(options: { withNotifier?: boolean } = {}) {
  const tools: RegisteredTool[] = [];
  const server: any = {
    tool(
      name: string,
      description: string,
      schema: any,
      annotationsOrHandler: any,
      maybeHandler?: any
    ) {
      // Support both 4-param (legacy) and 5-param (with annotations) signatures
      const isLegacy = typeof annotationsOrHandler === "function";
      const annotations = isLegacy ? undefined : annotationsOrHandler;
      const handler = isLegacy ? annotationsOrHandler : maybeHandler;
      tools.push({ name, description, schema, annotations, handler });
    },
  };
  if (options.withNotifier) {
    server.server = {
      async notification({ method }: { method: string }) {
        // no-op; for verification in tests, we could spy on this
        return;
      },
    };
  }
  return { server, tools } as const;
}
