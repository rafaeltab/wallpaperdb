/**
 * Time service interface for dependency injection and testing.
 * Abstracts time-related operations to enable time-based testing.
 */
export interface TimeService {
  /**
   * Get the current date and time.
   * @returns Current Date
   */
  now(): Date;

  /**
   * Get a date that is a specified number of milliseconds ago.
   * @param ms - Milliseconds in the past
   * @returns Date in the past
   */
  msAgo(ms: number): Date;

  /**
   * Get a date that is a specified number of minutes ago.
   * @param minutes - Minutes in the past
   * @returns Date in the past
   */
  minutesAgo(minutes: number): Date;

  /**
   * Get a date that is a specified number of hours ago.
   * @param hours - Hours in the past
   * @returns Date in the past
   */
  hoursAgo(hours: number): Date;
}

/**
 * System time service - uses actual system time.
 * This is the default implementation for production use.
 */
export class SystemTimeService implements TimeService {
  now(): Date {
    return new Date();
  }

  msAgo(ms: number): Date {
    return new Date(Date.now() - ms);
  }

  minutesAgo(minutes: number): Date {
    return new Date(Date.now() - minutes * 60 * 1000);
  }

  hoursAgo(hours: number): Date {
    return new Date(Date.now() - hours * 60 * 60 * 1000);
  }
}

/**
 * Mock time service for testing.
 * Allows tests to control the current time.
 */
export class MockTimeService implements TimeService {
  constructor(private currentTime: Date = new Date()) {}

  /**
   * Set the current time for testing.
   * @param time - The time to set
   */
  setTime(time: Date): void {
    this.currentTime = time;
  }

  now(): Date {
    return this.currentTime;
  }

  msAgo(ms: number): Date {
    return new Date(this.currentTime.getTime() - ms);
  }

  minutesAgo(minutes: number): Date {
    return new Date(this.currentTime.getTime() - minutes * 60 * 1000);
  }

  hoursAgo(hours: number): Date {
    return new Date(this.currentTime.getTime() - hours * 60 * 60 * 1000);
  }
}
