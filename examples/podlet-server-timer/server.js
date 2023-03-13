export default async function server(app, { config, podlet }) {
    app.setContentState(() => ({
      timerA: "7",
      timerB: "60",
      timerC: "300",
    }));
  }