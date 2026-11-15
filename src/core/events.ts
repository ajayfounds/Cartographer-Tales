// Tiny typed event bus. Game logic emits; UI and audio listen.
import type { ZoneId } from '../world/layout';

export interface Events {
  'zone:enter': { zone: ZoneId | 0 };
  'zone:complete': { zone: ZoneId };
  'dp:found': { id: string; label: string };
  'achievement': { id: string };
  'state:changed': undefined;
  'caption': { text: string };
}

type Handler<T> = (payload: T) => void;

export class Bus {
  private map = new Map<string, Handler<never>[]>();
  on<K extends keyof Events>(type: K, fn: Handler<Events[K]>) {
    const list = this.map.get(type) ?? [];
    list.push(fn as Handler<never>);
    this.map.set(type, list);
  }
  emit<K extends keyof Events>(type: K, ...payload: Events[K] extends undefined ? [] : [Events[K]]) {
    for (const fn of this.map.get(type) ?? []) (fn as Handler<unknown>)(payload[0]);
  }
}
