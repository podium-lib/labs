import { html, css } from "lit";
import { PodiumElement } from "@podium/experimental-podium-element";

import timer from './src/timer.js'

export default class Content extends PodiumElement {
  static styles = css`
    :host {
      font-family: 'JetBrains Mono', monospace;
      font-size: 36px;
    }
  `;

  render() {
    return html`
      <lit-timer duration="${this.initialState.timerA}"></lit-timer>
      <lit-timer duration="${this.initialState.timerB}"></lit-timer>
      <lit-timer duration="${this.initialState.timerC}"></lit-timer>
    `;
  }
}