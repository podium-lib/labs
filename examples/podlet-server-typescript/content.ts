import { html, css } from "lit";
import { PodiumElement } from "@podium/experimental-podium-element";

export default class Content extends PodiumElement {
  static styles = css`
    .demo {
      color: hotpink;
    }
  `;

  render() {
    return html`<section class="demo">This is a typescript demo</section>`;
  }
}