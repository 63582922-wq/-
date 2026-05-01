declare module "lunar-javascript" {
  export class Solar {
    static fromYmd(year: number, month: number, day: number): Solar;
    getLunar(): Lunar;
    toYmd(): string;
  }

  export class Lunar {
    static fromYmd(lunarYear: number, lunarMonth: number, lunarDay: number): Lunar;
    getSolar(): Solar;
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    toString(): string;
  }

  export class LunarYear {
    static fromYear(lunarYear: number): LunarYear;
    getMonthsInYear(): LunarMonth[];
  }

  export class LunarMonth {
    getMonth(): number;
    isLeap(): boolean;
    getDayCount(): number;
  }
}
