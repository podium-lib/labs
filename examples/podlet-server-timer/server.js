export default async function server(app, { config, podlet })  {
    app.setContentState(async () => ({
      timerA: "7",
      timerB: "60",
      timerC: "300",
    }));

    return app;
};