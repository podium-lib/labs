// @ts-ignore
import { LitElement } from "lit";

export class PodiumPodletElement extends LitElement {
  getInitialState() {
    try {
      // @ts-ignore
      return JSON.parse(this.getAttribute("initial-state") || '{}');
    } catch (err) {
      return {};
    }
  }
}
