import { html, css } from "lit";
import { PodiumElement } from "@podium/experimental-podium-element";

export default class Content extends PodiumElement {
  static styles = css`
    .demo {
      color: black;
    }
  `;

  render() {
    return html`
      <section class="demo">
        <p>This is a ${this.initialState.title} demo.</p>
        <p>The time is now: ${this.initialState.now}.</p>
      </section>
    `;
  }
}