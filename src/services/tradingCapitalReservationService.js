export default class TradingCapitalReservationService {
  constructor() {
    this.reservedUsdt = 0;
    this.pendingReservations = [];
    this.sequence = 0;
    this.drainScheduled = false;
  }

  getReservedUsdt() {
    return this.reservedUsdt;
  }

  nextSequence() {
    return this.sequence++;
  }

  reserve(amount) {
    const value = this.validateAmount(amount);

    this.reservedUsdt += value;

    return {
      reserved: true,
      amount: value,
      totalReservedUsdt: this.reservedUsdt,
    };
  }

  release(amount) {
    const value = this.validateAmount(amount);

    this.reservedUsdt = Math.max(
      0,
      this.reservedUsdt - value,
    );

    this.scheduleDrain();

    return {
      released: true,
      amount: value,
      totalReservedUsdt: this.reservedUsdt,
    };
  }

  canReserve(availableUsdt, amount) {
    const available = this.validateAvailable(availableUsdt);
    const required = this.validateAmount(amount);

    const usable = available - this.reservedUsdt;

    return {
      allowed: usable >= required,
      availableUsdt: available,
      reservedUsdt: this.reservedUsdt,
      usableUsdt: usable,
      requiredUsdt: required,
      shortfallUsdt:
        usable >= required ? 0 : required - usable,
    };
  }

  async acquire(availableUsdt, amount, sequence = null) {
    const available = this.validateAvailable(availableUsdt);
    const required = this.validateAmount(amount);
    const requestSequence =
      sequence === null ? this.nextSequence() : sequence;

    return new Promise((resolve, reject) => {
      this.pendingReservations.push({
        availableUsdt: available,
        requiredUsdt: required,
        sequence: requestSequence,
        resolve,
        reject,
      });

      this.scheduleDrain();
    });
  }

  cancelAcquisition(reservation) {
    if (!reservation) {
      return false;
    }

    const index = this.pendingReservations.indexOf(reservation);

    if (index === -1) {
      return false;
    }

    this.pendingReservations.splice(index, 1);
    return true;
  }

  scheduleDrain() {
    if (this.drainScheduled) {
      return;
    }

    this.drainScheduled = true;

    setImmediate(() => {
      this.drainScheduled = false;
      this.drain();
    });
  }

  drain() {
    if (this.pendingReservations.length === 0) {
      return;
    }

    this.pendingReservations.sort((a, b) => {
      if (a.requiredUsdt !== b.requiredUsdt) {
        return a.requiredUsdt - b.requiredUsdt;
      }

      return a.sequence - b.sequence;
    });

    const remaining = [];

    for (const request of this.pendingReservations) {
      const result = this.canReserve(
        request.availableUsdt,
        request.requiredUsdt,
      );

      if (!result.allowed) {
        remaining.push(request);
        continue;
      }

      this.reserve(request.requiredUsdt);

      request.resolve({
        ...result,
        reserved: true,
        totalReservedUsdt: this.reservedUsdt,
      });
    }

    this.pendingReservations = remaining;
  }

  validateAmount(amount) {
    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0) {
      throw new Error("Reservation amount must be greater than 0");
    }

    return value;
  }

  validateAvailable(availableUsdt) {
    const value = Number(availableUsdt);

    if (!Number.isFinite(value) || value < 0) {
      throw new Error("Valid available USDT balance is required");
    }

    return value;
  }
}
