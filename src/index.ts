import ynab from "npm:ynab";
import fs from "node:fs";
import day from "npm:dayjs";

const { TOKEN, BUDGET } = Deno.env.toObject();

const ynabAPI = new ynab.API(TOKEN);

const response = await ynabAPI.transactions.getTransactions(BUDGET);
const { transactions } = response.data;

const data = JSON.parse(
  fs.readFileSync("/Users/samdenty/Downloads/Tesco-Customer-Data.json", "utf8")
);

const purchases: any[] = data.Purchase.flat();

const transactionsToUpdate: ynab.TransactionDetail[] = [];

purchases.map((purchase) => {
  const time = day(purchase.timeStamp).startOf("day");
  const amount = -parseAmount(purchase.basketValueNet);

  let totalAmount = 0;

  (purchase.product as any[]).forEach((product, i) => {
    product.amount = -parseAmount(product.price) * product.quantity;
    totalAmount += product.amount;
  });

  const ratio = amount / totalAmount;
  totalAmount = 0;

  (purchase.product as any[]).forEach((product, i) => {
    product.amount =
      i === purchase.product.length - 1
        ? Math.abs(totalAmount) - Math.abs(amount)
        : Math.round(product.amount * ratio);

    totalAmount += product.amount;
  });

  (purchase.product as any[]).sort((a, b) => a.amount - b.amount);

  const possibleTransactions = transactions.filter((transaction) => {
    const transactionTime = day(transaction.date).startOf("day");

    if (transaction.payee_name !== "Tesco" || transaction.amount > 0) {
      return false;
    }

    if (transactionTime < time || transactionTime > time.add(1, "week")) {
      return false;
    }

    if (transaction.amount !== amount) {
      return false;
    }

    return true;
  });

  const transaction = possibleTransactions[0];
  if (!transaction) {
    return;
  }

  if (
    transaction.subtransactions.length ||
    (purchase.product.length === 1 && transaction.memo)
  ) {
    return;
  }

  if (purchase.product.length === 1) {
    transaction.memo = getDescription(purchase.product[0]);
  } else {
    transaction.subtransactions = [];
    transaction.subtransactions = (purchase.product as any[]).map(
      (product): any => ({
        amount: product.amount,
        payee_id: transaction.payee_id,
        payee_name: transaction.payee_name,
        category_id: transaction.category_id,
        memo: getDescription(product),
      })
    );
  }

  transactionsToUpdate.push(transaction);
});

await ynabAPI.transactions.updateTransactions(BUDGET, {
  transactions: transactionsToUpdate,
});

function parseAmount(amount: string) {
  const [euros, cents = ""] = amount.split(".");
  return parseInt(`${euros}${cents.padEnd(2, "0")}`) * 10;
}

function getDescription(item: any) {
  if (item.name.toLowerCase().includes("home delivery")) {
    return "Home Delivery Charge";
  }

  if (item.quantity === "1") {
    return item.name;
  }

  return `${item.quantity}x ${item.name}`;
}
