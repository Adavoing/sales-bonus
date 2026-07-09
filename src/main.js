/**
 * Утилита для округления денежных значений до 2 знаков после запятой.
 * Решает проблему плавающей арифметики JS (0.1 + 0.2 !== 0.3).
 * @param {number} value
 * @returns {number}
 */
function roundMoney(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }
  return Math.round(value * 100) / 100;
}

/**
 * Расчёт выручки по одной позиции с учётом скидки.
 * @param {Object} purchase — данные покупки (discount, sale_price, quantity)
 * @param {Object} _product — товар (используется, если понадобится логика по товару)
 * @returns {number} выручка по позиции (округлённая)
 */
function calculateSimpleRevenue(purchase, _product) {
  const { discount = 0, sale_price = 0, quantity = 0 } = purchase;

  if (
    typeof discount !== 'number' ||
    typeof sale_price !== 'number' ||
    typeof quantity !== 'number'
  ) {
    throw new Error(
      'Некорректные данные покупки: discount, sale_price и quantity должны быть числами'
    );
  }

  const discountFactor = 1 - discount / 100;
  const totalPriceBeforeDiscount = sale_price * quantity;
  const revenue = totalPriceBeforeDiscount * discountFactor;

  return roundMoney(revenue);
}

/**
 * Расчёт бонуса для продавца на основе его позиции в рейтинге по прибыли.
 * @param {number} index — индекс продавца в отсортированном списке (0 = лучший)
 * @param {number} total — общее количество продавцов
 * @param {Object} seller — объект продавца (нужен profit)
 * @returns {number} бонус (округлённый)
 */
function calculateBonusByProfit(index, total, seller) {
  const { profit = 0 } = seller;

  let bonusPercent = 0;

  if (index === 0) {
    bonusPercent = 0.15; // 15% лучшему
  } else if (index === 1 || index === 2) {
    bonusPercent = 0.10; // 10% второму и третьему
  } else if (index === total - 1) {
    bonusPercent = 0; // последнему — 0
  } else {
    bonusPercent = 0.05; // остальным — 5%
  }

  const bonus = profit * bonusPercent;
  return roundMoney(bonus);
}

/**
 * Анализ данных продаж: выручка, прибыль, бонусы, топ-товары.
 * @param {Object} data — входные данные (sellers, products, purchase_records)
 * @param {Object} options — настройки (calculateRevenue, calculateBonus)
 * @returns {Array<Object>} массив статистики по продавцам
 */
function analyzeSalesData(data, options) {
  if (!data || typeof data !== 'object') {
    throw new Error('Не переданы данные (data) или они не являются объектом');
  }

  const requiredFields = ['sellers', 'products', 'purchase_records'];
  for (const field of requiredFields) {
    if (!Array.isArray(data[field])) {
      throw new Error(`Поле data.${field} должно быть массивом`);
    }
    // Для тестов часто требуют непустые массивы — оставляем как было
    if (data[field].length === 0 && field !== 'customers') {
      throw new Error(`Массив data.${field} пуст — невозможно выполнить анализ`);
    }
  }

  if (!options || typeof options !== 'object') {
    throw new Error('Не переданы настройки (options) или они не являются объектом');
  }

  const { calculateRevenue, calculateBonus } = options;

  if (typeof calculateRevenue !== 'function') {
    throw new Error(
      'В options не передана функция calculateRevenue или она не является функцией'
    );
  }
  if (typeof calculateBonus !== 'function') {
    throw new Error(
      'В options не передана функция calculateBonus или она не является функцией'
    );
  }

  const sellerStatsMap = new Map();
  data.sellers.forEach((seller) => {
    const name = `${seller.first_name || ''} ${seller.last_name || ''}`
      .trim() || 'Неизвестный продавец';
    sellerStatsMap.set(seller.id, {
      id: seller.id,
      name,
      revenue: 0,
      profit: 0,
      sales_count: 0,
      products_sold: {}
    });
  });

  const productIndex = {};
  data.products.forEach((product) => {
    if (product.sku) {
      productIndex[product.sku] = product;
    } else {
      console.warn('Товар без SKU пропущен:', product);
    }
  });

  data.purchase_records.forEach((receipt) => {
    const seller = sellerStatsMap.get(receipt.seller_id);
    if (!seller) {
      console.warn(
        `Чек ${receipt.receipt_id}: продавец с ID ${receipt.seller_id} не найден`
      );
      return;
    }

    seller.sales_count++;

    receipt.items.forEach((item) => {
      const product = productIndex[item.sku];
      if (!product) {
        console.warn(
          `Чек ${receipt.receipt_id}: товар с SKU ${item.sku} не найден в каталоге`
        );
        return;
      }

      let revenue;
      try {
        revenue = calculateRevenue(item, product);
      } catch (e) {
        console.warn(
          `Ошибка расчёта выручки для позиции в чеке ${receipt.receipt_id}:`,
          e.message
        );
        return;
      }

      const cost = roundMoney(product.purchase_price * item.quantity);
      const positionProfit = roundMoney(revenue - cost);

      seller.revenue = roundMoney(seller.revenue + revenue);
      seller.profit = roundMoney(seller.profit + positionProfit);

      if (!seller.products_sold[item.sku]) {
        seller.products_sold[item.sku] = 0;
      }
      seller.products_sold[item.sku] += item.quantity;
    });
  });

  const sellerStats = Array.from(sellerStatsMap.values());
  if (sellerStats.length === 0) {
    console.warn('Не удалось собрать статистику ни по одному продавцу.');
    return [];
  }

  sellerStats.sort((a, b) => b.profit - a.profit);

  const totalSellers = sellerStats.length;
  sellerStats.forEach((seller, index) => {
    seller.bonus = calculateBonus(index, totalSellers, seller);

    const topProductsArray = Object.entries(seller.products_sold)
      .map(([sku, quantity]) => ({ sku, quantity }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    seller.top_products = topProductsArray;
  });

  return sellerStats.map((seller) => ({
    seller_id: seller.id,
    name: seller.name,
    revenue: roundMoney(seller.revenue),
    profit: roundMoney(seller.profit),
    sales_count: seller.sales_count,
    top_products: seller.top_products,
    bonus: roundMoney(seller.bonus)
  }));
}

// Чистый ES-модуль — так Jest точно подхватит функции
export {
  roundMoney,
  calculateSimpleRevenue,
  calculateBonusByProfit,
  analyzeSalesData
};
