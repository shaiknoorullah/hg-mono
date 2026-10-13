package payments

import (
	"context"
	"fmt"
)

// staffAs is a member of staff signed in with an authenticator code.
func staffAs(id string, roles ...string) Staff {
	return Staff{AccountID: id, Roles: roles, MFA: true}
}

// issueAs issues an admin refund without an idempotency key and splits the
// outcome into issueRefund's two answers.
func issueAs(ctx context.Context, svc *Service, in AdminRefundInput, id string, roles ...string) (RefundDTO, RefundApprovalRequestDTO, bool, error) {
	out, err := svc.IssueAdminRefund(ctx, in, staffAs(id, roles...), nil)
	if err != nil {
		return RefundDTO{}, RefundApprovalRequestDTO{}, false, err
	}
	switch d := out.Data.(type) {
	case RefundDTO:
		return d, RefundApprovalRequestDTO{}, false, nil
	case RefundApprovalRequestDTO:
		return RefundDTO{}, d, true, nil
	}
	return RefundDTO{}, RefundApprovalRequestDTO{}, false, fmt.Errorf("unexpected outcome %+v", out)
}

// approveAs approves a refund without an idempotency key.
func approveAs(ctx context.Context, svc *Service, refundID, id string, roles ...string) (AdminRefundDTO, error) {
	out, err := svc.ApproveRefund(ctx, refundID, staffAs(id, roles...),
		RefundDecisionInput{ReasonText: "checked against the order and its photos"}, nil)
	if err != nil {
		return AdminRefundDTO{}, err
	}
	return out.Data.(AdminRefundDTO), nil
}
