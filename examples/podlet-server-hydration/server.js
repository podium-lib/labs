export default async function server(app, { config, podlet }) {
  app.setContentState(() => ({
    title: "hydration",
    now: Date.now().toString(),
  }));
}