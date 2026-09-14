export default class TradingCapitalReservationService {
  constructor() {
    this.reservedUsdt = 0;
    this.activeReservations = new Map();
    this.pendingReservations = [];
    this.sequence = 0;
    this.reservationId = 0;
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
    const id = `reservation-${++this.reservationId}`;

    this.reservedUsdt += value;
    this.activeReservations.set(id, value);

    return {
      id,
      reserved: true,
      amount: value,
      totalReservedUsdt: this.reservedUsdt,
    };
  }

  release(reservation) {
    if (!reservation) {
      return {
        released: false,
        amount: 0,
        totalReservedUsdt: this.reservedUsdt,
        reason: "RESERVATION_NOT_FOUND",
      };
    }

    const id =
      typeof reservation === "string"
        ? reservation
        : reservation.id;

    if (!id || !this.activeReservations.has(id)) {
      return {
        released: false,
        amount: 0,
        totalReservedUsdt: this.reservedUsdt,
        reason: "RESERVATION_NOT_FOUND",
      };
    }

    const amount = this.activeReservations.get(id);

    this.activeReservations.delete(id);
    this.reservedUsdt = Math.max(
      0,
      this.reservedUsdt - amount,
    );

    this.scheduleDrain();

    return {
      released: true,
      id,
      amount,
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

  acquire(availableUsdt, amount, sequence = null) {
    const available = this.validateAvailable(availableUsdt);
    const required = this.validateAmount(amount);
    const requestSequence =
      sequence === null ? this.nextSequence() : sequence;

    let request;

    const promise = new Promise((resolve, reject) => {
      request = {
        availableUsdt: available,
        requiredUsdt: required,
        sequence: requestSequence,
        resolve,
        reject,
      };

      this.pendingReservations.push(request);
      this.scheduleDrain();
    });

    promise.cancel = () => this.cancelAcquisition(request);

    return promise;
  }

  cancelAcquisition(request) {
    if (!request) {
      return false;
    }

    const index = this.pendingReservations.indexOf(request);

    if (index === -1) {
      return false;
    }

    this.pendingReservations.splice(index, 1);

    request.reject(
      new Error("Reservation acquisition cancelled"),
    );

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

      const reservation = this.reserve(
        request.requiredUsdt,
      );

      request.resolve({
        ...result,
        ...reservation,
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
