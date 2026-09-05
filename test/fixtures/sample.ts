export interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: string;
  items: OrderItem[];
  customerEmail: string;
  isVip?: boolean;
}

export class OrderService {
  private taxRate = 0.08;

  constructor() {}

  async processOrder(order: Order): Promise<boolean> {
    if (!order.id) {
      this.logError("Order ID missing");
      return false;
    } else if (order.items.length === 0) {
      this.logError("Empty cart");
      return false;
    } else {
      const subtotal = this.calculateSubtotal(order.items);
      const discount = this.calculateDiscount(subtotal, order.isVip);
      const total = subtotal - discount;

      for (const item of order.items) {
        if (item.quantity > 10) {
          this.applyBulkDiscount(item);
        }
      }

      try {
        await this.chargeCustomer(order.customerEmail, total);
        await sendConfirmationEmail(order.customerEmail);
      } catch (err) {
        this.logError(String(err));
        return false;
      }

      return true;
    }
  }

  calculateSubtotal(items: OrderItem[]): number {
    let sum = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item) {
        sum += item.price * item.quantity;
      }
    }
    return sum;
  }

  calculateDiscount(subtotal: number, isVip?: boolean): number {
    switch (isVip ? "VIP" : "REGULAR") {
      case "VIP":
        return subtotal * 0.2;
      default:
        return 0;
    }
  }

  applyBulkDiscount(item: OrderItem): void {
    item.price = item.price * 0.9;
  }

  async chargeCustomer(email: string, amount: number): Promise<void> {
    console.log(`Charging ${amount} to ${email}`);
  }

  logError(message: string): void {
    console.error(`[OrderError] ${message}`);
  }
}

export async function sendConfirmationEmail(email: string): Promise<void> {
  if (!email.includes("@")) {
    throw new Error("Invalid email format");
  }
  console.log(`Sending email to ${email}`);
}

export const helperUtility = (val: number): number => {
  let count = 0;
  while (count < val) {
    count++;
  }
  return count;
};
