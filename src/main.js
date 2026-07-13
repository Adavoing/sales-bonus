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

  if (discount < 0 || discount > 100) {
    throw new Error(`Некорректное значение скидки: ${discount}%. Должно быть от 0 до 100.`);
  }

  if (sale_price < 0) {
    throw new Error(`Некорректная цена продажи: ${sale_price}. Должно быть неотрицательным.`);
  }

  if (quantity <= 0) {
    throw new Error(`Некорректное количество: ${quantity}. Должно быть положительным.`);
  }

  const discountFactor = 1 - (discount / 100);
  const totalPriceBeforeDiscount = sale_price * quantity;
  const revenue = totalPriceBeforeDiscount * discountFactor;

  return Math.round(Math.max(0, revenue) * 100) / 100;
}

function calculateBonusByProfit(index, total, seller) {
  const { profit = 0 } = seller;

  if (profit < 0) {
    throw new Error(`Прибыль продавца не может быть отрицательной: ${profit}`);
  }

  if (index === 0) {
    return profit * 0.15;
  } else if (index === 1 || index === 2) {
    return profit * 0.10;
  } else if (index === total - 1) {
    return 0;
  } else {
    return profit * 0.05;
  }
  
}

function analyzeSalesData(data, options) {
  try {
    if (!data || typeof data !== 'object') {
      throw new Error('Не переданы данные (data) или они не являются объектом');
    }

    const requiredFields = ['sellers', 'products', 'purchase_records'];
    for (const field of requiredFields) {
      if (!Array.isArray(data[field])) {
        throw new Error(`Поле data.${field} должно быть массивом`);
      }
      if (data[field].length === 0 && field !== 'customers') {
        throw new Error(`Массив data.${field} пуст — невозможно выполнить анализ`);
      }
    }

    if (!options || typeof options !== 'object') {
      throw new Error('Не переданы настройки (options) или они не являются объектом');
    }

    const { calculateRevenue, calculateBonus } = options;

    if (typeof calculateRevenue !== 'function') {
      throw new Error('В options не передана функция calculateRevenue или она не является функцией');
    }
    if (typeof calculateBonus !== 'function') {
      throw new Error('В options не передана функция calculateBonus или она не является функцией');
    }

    const sellerStatsMap = new Map();
    data.sellers.forEach((seller) => {
      const name = `${seller.first_name || ''} ${seller.last_name || ''}`
        .trim() || 'Неизвестный продавец';
      sellerStatsMap.set(seller.id, {
        id: seller.id,
        name: name,
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
        console.warn(`Чек: продавец с ID ${receipt.seller_id} не найден`);
        return;
      }

      seller.sales_count++;

      if (!receipt.items || !Array.isArray(receipt.items)) {
        console.warn(`Чек: отсутствует или некорректен массив items`);
        return;
      }

      receipt.items.forEach((item) => {
        if (!item.sku) {
          console.warn(`Чек: в позиции отсутствует SKU`);
          return;
        }

        const product = productIndex[item.sku];

        if (!product) {
          console.warn(`Товар с SKU ${item.sku} не найден в каталоге`);
          return;
        }

        if (
          typeof product.purchase_price !== 'number' ||
          product.purchase_price < 0
        ) {
          console.warn(
            `Некорректная закупочная цена для товара ${item.sku}: ${product.purchase_price}`
          );
          return;
        }

        let revenue;
        try {
          revenue = calculateRevenue(item, product);
        } catch (e) {
          console.warn(`Ошибка расчёта выручки для позиции:`, e.message);
          return;
        }

        const cost = product.purchase_price * item.quantity;
        
        const positionProfit = revenue - cost;

        seller.revenue += revenue;
        seller.profit += positionProfit;

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
      try {
        seller.bonus = calculateBonus(index, totalSellers, seller);
      } catch (error) {
        console.warn(
          `Ошибка при расчёте бонуса для продавца ${seller.name}:`,
          error.message
        );
        seller.bonus = 0;
      }

      const topProductsArray = Object.entries(seller.products_sold)
        .map(([sku, quantity]) => ({ sku, quantity }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10);

      seller.top_products = topProductsArray;
    });

    return sellerStats.map((seller) => ({
      seller_id: seller.id,
      name: seller.name,
      revenue: Math.round(seller.revenue * 100) / 100,
      profit: Math.round(seller.profit * 100) / 100,
      sales_count: seller.sales_count,
      top_products: seller.top_products,
      bonus: Math.round(seller.bonus * 100) / 100
    }));
  } catch (error) {
    console.error('Критическая ошибка в analyzeSalesData:', error.message);
    throw error;
  }
}
