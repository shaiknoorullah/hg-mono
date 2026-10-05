# Restaurant Playbook: Menu Management & Review

This playbook scripts menu management, price updates, copy revisions that require administrative review, and item stock availability.

---

## 1. Menu Overview & Category Navigation

1. **Browser action**:
   - Open `/menu` as an authenticated restaurant manager or owner.
2. **Visible assertion**:
   - Page header displays **Menu**.
   - Category navigation list is displayed on the left column.
   - Menu items belonging to the active category are rendered with price, description, and status tags.

---

## 2. Add New Category and Item

1. **Browser action**:
   - Click **Add item**.
   - In the modal dialog, select the **New category** tab.
   - Enter category name: `Signature Platters`.
   - Enter item name: `Mixed Grill Deluxe`.
   - Enter price: `24.50`.
   - Enter description: `Lamb chops, chicken shish, and beef kofta with spiced rice.`
   - Click **Add item**.
2. **Visible assertion**:
   - Modal closes.
   - New category `Signature Platters` appears in the category list.
   - `Mixed Grill Deluxe` is listed with price `$24.50`.

---

## 3. Immediate Price Update

1. **Browser action**:
   - Click the edit icon button on `Mixed Grill Deluxe`.
   - Change **Price (CAD)** to `26.00`.
   - Click **Save changes**.
2. **Visible assertion**:
   - Price updates instantly to `$26.00` without requiring platform approval.
   - Price modifications take effect immediately across all customer cart calculations.

---

## 4. Copy Revisions & Admin Review Badge

1. **Browser action**:
   - Edit `Mixed Grill Deluxe` again.
   - Change item name to `Royal Mixed Grill Feast`.
   - Click **Save changes**.
2. **Visible assertion**:
   - Item row displays a warning chip: **Edit pending review**.
   - Note explains: "Price and prep time apply instantly. Name, description, and ingredients queue for admin review before customers see them."

---

## 5. Item Availability Toggle (Out of Stock)

1. **Browser action**:
   - Locate the availability switch on an item.
   - Toggle the switch from **Available** to **Out of stock**.
2. **Visible assertion**:
   - Switch state changes to unchecked.
   - Item status label updates to **Out of stock**.
   - Out-of-stock items remain listed in the catalog but cannot be added to customer carts.
