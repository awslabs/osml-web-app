// Copyright Amazon.com, Inc. or its affiliates.
declare module "ol-ext/source/DayNight" {
  import VectorSource from "ol/source/Vector";

  interface DayNightOptions {
    time?: string | Date;
    step?: number;
  }

  export default class DayNight extends VectorSource {
    constructor(options?: DayNightOptions);
    setTime(time: string | Date): void;
    getSunPosition(time?: string): [number, number];
    getCoordinates(
      time?: string | Date,
      options?: "line" | "day" | "night" | "daynight"
    ): number[][] | number[][][];
    static getNightLat(lon: number, time?: Date): number;
  }
}
