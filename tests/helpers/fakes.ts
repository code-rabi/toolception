export type RegisteredTool = {
  name: string;
  description: string;
  schema: any;
  annotations?: {
    title?: string;
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
    registerTool(
      name: string,
      config: { description: string; inputSchema?: any; annotations?: RegisteredTool["annotations"] },
      handler: (args: any) => Promise<any> | any
    ) {
      const entry: RegisteredTool = {
        name,
        description: config.description,
        schema: config.inputSchema,
        annotations: config.annotations,
        handler,
      };
      tools.push(entry);
      return {
        remove() {
          const index = tools.indexOf(entry);
          if (index !== -1) tools.splice(index, 1);
        },
      };
    },
    async connect(_transport: unknown): Promise<void> {},
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
