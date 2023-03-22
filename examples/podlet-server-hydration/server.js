export default async function server(app, { config, podlet }) {
  app.setContentState(async () => ({
    title: "hydration",
    now: Date.now().toString(),
  }));

  return app;
}