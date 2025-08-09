export type RegisteredTool = {
  name: string;
  description: string;
  schema: any;
  handler: (args: any) => Promise<any> | any;
};

export function createFakeMcpServer(options: { withNotifier?: boolean } = {}) {
  const tools: RegisteredTool[] = [];
  const server: any = {
    tool(name: string, description: string, schema: any, handler: any) {
      tools.push({ name, description, schema, handler });
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
